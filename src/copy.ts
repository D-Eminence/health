export function plural(count: number, singular: string, multiple = singular + "s") {
  return `${count} ${count === 1 ? singular : multiple}`;
}
