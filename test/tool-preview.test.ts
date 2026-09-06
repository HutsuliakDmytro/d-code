import { describe, it, expect } from 'vitest'
import { predictContent } from '../src/renderer/src/components/ToolPreview'

describe('predictContent', () => {
  const file = 'рядок один\nрядок два\nрядок три'

  it('Write замінює вміст цілком', () => {
    expect(predictContent(file, { content: 'зовсім інше' })).toBe('зовсім інше')
  })

  it('Edit підставляє заміну', () => {
    const result = predictContent(file, { old_string: 'рядок два', new_string: 'ЗМІНЕНО' })
    expect(result).toBe('рядок один\nЗМІНЕНО\nрядок три')
  })

  it('MultiEdit застосовує правки послідовно', () => {
    const result = predictContent(file, {
      edits: [
        { old_string: 'один', new_string: '1' },
        { old_string: 'три', new_string: '3' }
      ]
    })
    expect(result).toBe('рядок 1\nрядок два\nрядок 3')
  })

  it('порожній old_string означає створення файлу', () => {
    expect(predictContent('', { old_string: '', new_string: 'новий вміст' })).toBe('новий вміст')
  })

  it('не вигадує діф, коли фрагмента немає у файлі', () => {
    // Показати вигаданий діф гірше, ніж показати сирі аргументи.
    expect(predictContent(file, { old_string: 'такого немає', new_string: 'X' })).toBeUndefined()
  })

  it('не вигадує діф на незнайомій формі аргументів', () => {
    expect(predictContent(file, {})).toBeUndefined()
    expect(predictContent(file, { edits: [{ old_string: 'один' }] })).toBeUndefined()
  })

  it('замінює лише перше входження, як це робить Edit', () => {
    const repeated = 'дубль\nдубль'
    expect(predictContent(repeated, { old_string: 'дубль', new_string: 'X' })).toBe('X\nдубль')
  })
})
