/** BigInt stays a decimal string on JSON boundaries; never lose monetary precision. */
export function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
}
