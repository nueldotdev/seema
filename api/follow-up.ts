import { requireUser, requestMethod, type VercelRequest, type VercelResponse } from '../backend/server.js'

interface CaptureResult {
  explanation?: string
  resources?: Array<{ title?: string; url?: string; source?: string }>
}

export default async function createFollowUp(request: VercelRequest, response: VercelResponse) {
  if (!requestMethod(request, response, ['POST'])) return

  const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : {}
  const captureId = body.capture_id
  const question = typeof body.question === 'string' ? body.question.trim() : ''
  const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
  if (typeof captureId !== 'string' || !uuidPattern.test(captureId) ||
      question.length < 1 || question.length > 1000) {
    return response.status(400).json({ error: 'A valid topic and question are required' })
  }

  try {
    const auth = await requireUser(request)
    if (auth.error || !auth.client || !auth.user) {
      return response.status(401).json({ error: auth.error ?? 'Sign in to continue' })
    }

    const { data: capture, error: captureError } = await auth.client.from('captures')
      .select('id,text,status,result,followup_count')
      .eq('id', captureId)
      .eq('user_id', auth.user.id)
      .maybeSingle()
    if (captureError) {
      console.error('Follow-up capture lookup failed:', captureError.message)
      return response.status(500).json({ error: 'Unable to load this saved topic' })
    }
    if (!capture) return response.status(404).json({ error: 'This saved topic could not be found' })
    if (capture.status !== 'researched' || !capture.result) {
      return response.status(409).json({ error: 'This topic does not have research to discuss yet' })
    }
    const result = capture.result as CaptureResult
    const explanation = typeof result.explanation === 'string' ? result.explanation : ''
    if (!explanation) return response.status(409).json({ error: 'This topic has no saved explanation to discuss' })
    if (capture.followup_count >= 10) {
      return response.status(409).json({ error: 'This topic has reached its limit of 10 questions' })
    }

    const { data: previous, error: previousError } = await auth.client.from('capture_followups')
      .select('question,answer')
      .eq('capture_id', captureId)
      .order('created_at', { ascending: true })
    if (previousError) {
      console.error('Follow-up discussion history lookup failed:', previousError.message)
      return response.status(500).json({ error: 'Unable to load this topic’s discussion' })
    }

    const sources = Array.isArray(result.resources)
      ? result.resources.filter((resource) =>
          typeof resource?.title === 'string' &&
          typeof resource.url === 'string' &&
          /^https?:\/\//i.test(resource.url),
        ).map((resource) => ({ title: resource.title, source: resource.source, url: resource.url }))
      : []
    const conversation = (previous ?? []).map((entry, index) =>
      `${index + 1}. Question: ${entry.question}\nAnswer: ${entry.answer}`,
    ).join('\n\n')
    const apiKey = process.env.GEMINI_API_KEY
    const model = process.env.GEMINI_MODEL
    if (!apiKey || !model) throw new Error('GEMINI_API_KEY and GEMINI_MODEL must be configured')
    const prompt = `You are Seema. Answer the user's next follow-up in a short, focused conversation about one saved topic. Use ONLY the topic's saved explanation and sources as factual evidence. Do not search, use outside knowledge, or discuss anything outside this topic. The previous turns are included only to understand references such as "that" or "why"; they are not additional evidence. If the saved topic material cannot answer the question, say so plainly and briefly. Aim for 2-4 sentences.

Saved topic: ${capture.text}
Saved explanation: ${explanation}
Saved sources: ${JSON.stringify(sources)}
Previous questions and answers in this topic's discussion:
${conversation || '(none)'}

New follow-up question: ${question}`
    const generation = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
      }),
    })
    if (!generation.ok) throw new Error(`Gemini follow-up failed (${generation.status}): ${await generation.text()}`)
    const generated = await generation.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const answer = generated.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim()
    if (!answer || answer.length > 6000) throw new Error('Gemini returned an invalid follow-up answer')

    const { data: followUp, error: insertError } = await auth.client.from('capture_followups')
      .insert({ user_id: auth.user.id, capture_id: captureId, question, answer })
      .select('id,capture_id,question,answer,created_at')
      .single()
    if (insertError) {
      if (insertError.code === 'P0001') {
        return response.status(409).json({ error: 'This topic has reached its limit of 10 questions' })
      }
      console.error('Follow-up save failed:', insertError.message)
      return response.status(500).json({ error: 'Unable to save this follow-up' })
    }
    const { data: updatedCapture, error: countError } = await auth.client.from('captures')
      .select('followup_count')
      .eq('id', captureId)
      .eq('user_id', auth.user.id)
      .single()
    if (countError) {
      console.error('Follow-up usage count lookup failed:', countError.message)
      return response.status(500).json({ error: 'Follow-up saved, but its usage could not be confirmed' })
    }
    return response.status(200).json({ follow_up: followUp, used_count: updatedCapture.followup_count })
  } catch (error) {
    console.error('Capture follow-up request failed:', error)
    return response.status(500).json({ error: 'Unable to answer this follow-up right now' })
  }
}
