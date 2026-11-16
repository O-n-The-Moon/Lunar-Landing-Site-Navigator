import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePgdaValues } from './use-pgda-values'

const a = Uint8Array.from([1, 2])
const b = Uint8Array.from([3, 4])
const decoder = () => vi.fn(async (url: string) => (url === 'a.png' ? a : b))

describe('usePgdaValues', () => {
  it('is null while decoding, then the decoded values', async () => {
    const decode = decoder()
    const { result } = renderHook(({ url }) => usePgdaValues(url, decode), { initialProps: { url: 'a.png' as string | undefined } })
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).toBe(a))
  })

  it('is null without a url and never decodes', () => {
    const decode = decoder()
    const { result } = renderHook(() => usePgdaValues(undefined, decode))
    expect(result.current).toBeNull()
    expect(decode).not.toHaveBeenCalled()
  })

  it('returns an already decoded layer immediately when switching back, without decoding it again', async () => {
    const decode = decoder()
    const { result, rerender } = renderHook(({ url }) => usePgdaValues(url, decode), { initialProps: { url: 'a.png' as string | undefined } })
    await waitFor(() => expect(result.current).toBe(a))
    rerender({ url: 'b.png' })
    expect(result.current).toBeNull() // b is new: nothing to show yet, and never a's values
    await waitFor(() => expect(result.current).toBe(b))
    rerender({ url: 'a.png' })
    expect(result.current).toBe(a) // same render, no null in between
    await act(async () => {})
    expect(decode).toHaveBeenCalledTimes(2)
  })

  it('stays null for a url that fails to decode, and keeps working for others', async () => {
    const decode = vi.fn(async (url: string) => {
      if (url === 'bad.png') throw new Error('corrupt')
      return a
    })
    const { result, rerender } = renderHook(({ url }) => usePgdaValues(url, decode), { initialProps: { url: 'bad.png' as string | undefined } })
    await act(async () => {})
    expect(result.current).toBeNull()
    rerender({ url: 'a.png' })
    await waitFor(() => expect(result.current).toBe(a))
  })
})
