export function localDateAndMinute(timezone: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const date = `${values.year}-${values.month}-${values.day}`
  const currentMinute = Number(values.hour) * 60 + Number(values.minute)
  return { date, currentMinute }
}

export function localMidnightAsUtc(date: string, timezone: string) {
  const [year, month, day] = date.split('-').map(Number)
  const desiredUtc = Date.UTC(year, month - 1, day)
  let candidate = desiredUtc
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  for (let attempt = 0; attempt < 3; attempt++) {
    const values = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]))
    const formattedAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    )
    const adjustment = desiredUtc - formattedAsUtc
    candidate += adjustment
    if (adjustment === 0) break
  }
  return new Date(candidate).toISOString()
}
