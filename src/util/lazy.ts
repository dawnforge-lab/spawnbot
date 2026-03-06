export function lazy<T>(fn: () => T) {
  let value: T | undefined
  let loaded = false

  const get = (): T => {
    if (loaded) return value as T
    loaded = true
    value = fn()
    return value as T
  }

  get.reset = () => {
    loaded = false
    value = undefined
  }

  return get
}
