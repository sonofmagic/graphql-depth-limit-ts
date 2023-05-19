export default function arrify<ValueType>(value: ValueType): ValueType extends
  | null
  | undefined
  ? [] // eslint-disable-line  @typescript-eslint/ban-types
  : ValueType extends string
  ? [string]
  : ValueType extends readonly unknown[]
  ? ValueType
  : ValueType extends Iterable<infer T>
  ? T[]
  : [ValueType]
