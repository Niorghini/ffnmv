/**
 * Editor 组件测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db, openDb } from '@/lib/db'
import { notesRepo } from '@/repositories/notesRepo'
import Editor from '@/components/Editor'

describe('Editor', () => {
  beforeEach(async () => {
    await openDb()
    await db.notes.clear()
    await db.sync_queue.clear()
  })

  it('新建模式：渲染空 textarea + Ctrl+Enter 触发 create', async () => {
    const onSaved = vi.fn()
    render(<Editor note={undefined} onSaved={onSaved} />)
    const textarea = screen.getByPlaceholderText(/记录想法/)
    const user = userEvent.setup()
    await user.type(textarea, 'hello #work')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled()
    })
    const all = await db.notes.toArray()
    expect(all).toHaveLength(1)
    expect(all[0]?.content).toBe('hello #work')
  })

  it('编辑模式：300ms debounce 自动保存', async () => {
    const note = await notesRepo.create({ content: 'initial' })
    const onSaved = vi.fn()
    render(<Editor note={note} onSaved={onSaved} />)
    const textarea = screen.getByDisplayValue('initial')
    const user = userEvent.setup()
    await user.clear(textarea)
    await user.type(textarea, 'updated')
    let n = await db.notes.get(note.id)
    expect(n?.content).toBe('initial')
    await waitFor(
      () => {
        expect(onSaved).toHaveBeenCalled()
      },
      { timeout: 600 },
    )
    n = await db.notes.get(note.id)
    expect(n?.content).toBe('updated')
  })

  it('状态切换：通过 NoteList 行的按钮（不在 Editor 里）', async () => {
    const note = await notesRepo.create({ content: 'x' })
    const onSaved = vi.fn()
    render(<Editor note={note} onSaved={onSaved} />)
    expect(screen.queryByTitle('切换状态')).toBeNull()
  })

  it('显示识别出的 #tags', async () => {
    const note = await notesRepo.create({ content: 'a #foo #bar b' })
    render(<Editor note={note} />)
    expect(screen.getByText('#foo')).toBeInTheDocument()
    expect(screen.getByText('#bar')).toBeInTheDocument()
  })

  it('新建模式：实时显示字数', async () => {
    render(<Editor note={undefined} onSaved={vi.fn()} />)
    expect(screen.getByText('0 字')).toBeInTheDocument()
    const textarea = screen.getByPlaceholderText(/记录想法/)
    const user = userEvent.setup()
    await user.type(textarea, '你好')
    expect(screen.getByText('2 字')).toBeInTheDocument()
  })

  it('发布按钮：空内容 disabled，有内容 enabled', async () => {
    render(<Editor note={undefined} onSaved={vi.fn()} />)
    const sendBtn = screen.getByRole('button', { name: /发布/ })
    expect(sendBtn).toBeDisabled()
    const textarea = screen.getByPlaceholderText(/记录想法/)
    const user = userEvent.setup()
    await user.type(textarea, 'hi')
    expect(sendBtn).not.toBeDisabled()
  })

  it('发布按钮：点一下也触发 create', async () => {
    const onSaved = vi.fn()
    render(<Editor note={undefined} onSaved={onSaved} />)
    const textarea = screen.getByPlaceholderText(/记录想法/)
    const user = userEvent.setup()
    await user.type(textarea, 'click send')
    await user.click(screen.getByRole('button', { name: /发布/ }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const all = await db.notes.toArray()
    expect(all[0]?.content).toBe('click send')
  })
})