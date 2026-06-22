/**
 * Supabase mock：返回带 auth / from / channel 等接口的 fake 对象
 * - 状态保存在闭包内，测试用例自己控制
 * - 默认行为：成功返回空数据
 */

interface FakeTableRow {
  id?: string
  note_id?: string
  tag_id?: string
  user_id?: string
  version?: number
  updated_at?: string
  last_sync_device?: string
  [key: string]: unknown
}

interface FakeSupabaseState {
  user: FakeUser | null
  tables: Record<string, Map<string, FakeTableRow>>
  realtimeHandlers: Array<{ channel: string; filter: unknown; handler: (p: unknown) => void }>
  failNext: boolean
  failMessage: string
  [key: string]: unknown
}

export interface FakeUser {
  id: string
  email: string
  [key: string]: unknown
}

export interface FakeSupabaseOverrides {
  user?: FakeUser | null
  tables?: Record<string, Map<string, FakeTableRow>>
  realtimeHandlers?: FakeSupabaseState['realtimeHandlers']
  failNext?: boolean
  failMessage?: string
}

export interface FakeQueryResult<T = unknown> {
  data: T
  error: null
  status: number
  statusText: string
}

export interface FakeErrorResult {
  data: null
  error: { message: string }
  status: number
  statusText: string
}

export interface FakeChannel {
  on: (_evt: string, filter: unknown, handler: (p: unknown) => void) => FakeChannel
  subscribe: (cb?: (status: string) => void) => FakeChannel
  unsubscribe: () => void
  _trigger: (event: string, payload: unknown) => void
}

export interface FakeSupabase {
  state: FakeSupabaseState
  auth: {
    getUser: () => Promise<{ data: { user: FakeUser | null }; error: null }>
    getSession: () => Promise<{ data: { session: { user: FakeUser } | null }; error: null }>
    signInWithPassword: (creds: { email: string; password: string }) => Promise<{ data: { user: FakeUser; session: { user: FakeUser } } | null; error: { message: string } | null }>
    signUp: (creds: { email: string; password: string }) => Promise<{ data: { user: FakeUser; session: { user: FakeUser } } | null; error: { message: string } | null }>
    signOut: () => Promise<{ error: null }>
    onAuthStateChange: (handler: unknown) => { data: { subscription: { unsubscribe: () => void } } }
  }
  from: (name: string) => Record<string, unknown>
  removeChannel: (ch: { topic?: string } | null | undefined) => void
  channel: (name: string) => FakeChannel
  _setUser: (user: FakeUser | null) => void
  _failNext: (msg?: string) => void
  _putRow: (tableName: string, row: FakeTableRow) => void
}

export const createFakeSupabase = (overrides: FakeSupabaseOverrides = {}): FakeSupabase => {
  const state: FakeSupabaseState = {
    user: null,
    tables: {
      notes: new Map(),
      tags: new Map(),
      note_tags: new Map(),
    },
    realtimeHandlers: [],
    failNext: false,
    failMessage: 'mocked error',
    ...overrides,
  }

  const okResult = <T>(data: T): FakeQueryResult<T> => ({
    data,
    error: null,
    status: 200,
    statusText: 'OK',
  })
  const errResult = (msg?: string): FakeErrorResult => ({
    data: null,
    error: { message: msg || state.failMessage },
    status: 400,
    statusText: 'Bad Request',
  })

  const wrap = <Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
  ): ((...args: Args) => Promise<FakeQueryResult<R> | FakeErrorResult>) => {
    return async (...args: Args) => {
      if (state.failNext) {
        state.failNext = false
        return errResult()
      }
      try {
        const result = await fn(...args)
        return okResult(result)
      } catch (e) {
        return errResult(e instanceof Error ? e.message : String(e))
      }
    }
  }

  const table = (name: string) => ({
    select() {
      return {
        gt() {
          return {
            order() {
              return wrap(async () => {
                const all = [...state.tables[name].values()]
                return all
              })()
            },
            async then(resolve: (r: FakeQueryResult<FakeTableRow[]>) => void) {
              const all = [...state.tables[name].values()]
              resolve(okResult(all))
            },
          }
        },
        order() {
          return wrap(async () => [...state.tables[name].values()])()
        },
        eq() {
          return this
        },
        async then(resolve: (r: FakeQueryResult<FakeTableRow[]>) => void) {
          resolve(okResult([...state.tables[name].values()]))
        },
      }
    },
    insert(rows: FakeTableRow | FakeTableRow[]) {
      return wrap(async () => {
        const arr = Array.isArray(rows) ? rows : [rows]
        for (const r of arr) {
          state.tables[name].set(r.id as string, r)
        }
        return arr
      })()
    },
    upsert(rows: FakeTableRow | FakeTableRow[], _opts?: unknown) {
      return wrap(async () => {
        const arr = Array.isArray(rows) ? rows : [rows]
        for (const r of arr) {
          const keyFn = name === 'note_tags'
            ? (r: FakeTableRow) => `${r.note_id}:${r.tag_id}`
            : (r: FakeTableRow) => r.id as string
          const k = keyFn(r)
          state.tables[name].set(k, r)
        }
        return arr
      })()
    },
    update(patch: Record<string, unknown>) {
      return {
        eq(col: string, val: unknown) {
          return wrap(async () => {
            let updated: FakeTableRow | null = null
            for (const r of state.tables[name].values()) {
              if (r[col] === val) {
                const merged = { ...r, ...patch }
                state.tables[name].set(r.id as string, merged)
                updated = merged
              }
            }
            return updated ? [updated] : []
          })()
        },
      }
    },
    delete() {
      return {
        eq(col: string, val: unknown) {
          return wrap(async (): Promise<FakeTableRow[]> => {
            for (const [k, r] of state.tables[name]) {
              if (r[col] === val) state.tables[name].delete(k)
            }
            return []
          })()
        },
      }
    },
  })

  return {
    state,
    auth: {
      async getUser() {
        return { data: { user: state.user }, error: null }
      },
      async getSession() {
        return { data: { session: state.user ? { user: state.user } : null }, error: null }
      },
      async signInWithPassword({ email, password: _password }) {
        if (state.failNext) {
          state.failNext = false
          return { data: null, error: { message: state.failMessage } }
        }
        const user: FakeUser = { id: 'user-1', email }
        state.user = user
        return { data: { user, session: { user } }, error: null }
      },
      async signUp({ email, password: _password }) {
        if (state.failNext) {
          state.failNext = false
          return { data: null, error: { message: state.failMessage } }
        }
        const user: FakeUser = { id: 'user-1', email }
        state.user = user
        return { data: { user, session: { user } }, error: null }
      },
      async signOut() {
        state.user = null
        return { error: null }
      },
      onAuthStateChange(_handler: unknown) {
        return {
          data: { subscription: { unsubscribe() { /* noop */ } } },
        }
      },
    },
    from(name: string) {
      if (!state.tables[name]) state.tables[name] = new Map()
      return table(name)
    },
    removeChannel(ch) {
      state.realtimeHandlers = state.realtimeHandlers.filter((h) => h.channel !== ch?.topic)
    },
    channel(name: string): FakeChannel {
      const handlers: Array<(p: unknown) => void> = []
      return {
        on(_evt, filter, handler) {
          handlers.push(handler)
          state.realtimeHandlers.push({ channel: name, filter, handler })
          return this
        },
        subscribe(cb) {
          if (cb) cb('SUBSCRIBED')
          return this
        },
        unsubscribe() { /* noop */ },
        _trigger(_event, payload) {
          for (const h of handlers) h(payload)
        },
      }
    },
    /** 测试用工具 */
    _setUser(user: FakeUser | null) {
      state.user = user
    },
    _failNext(msg?: string) {
      state.failNext = true
      state.failMessage = msg ?? 'mocked error'
    },
    _putRow(tableName: string, row: FakeTableRow) {
      if (!state.tables[tableName]) state.tables[tableName] = new Map()
      const keyFn = tableName === 'note_tags'
        ? (r: FakeTableRow) => `${r.note_id}:${r.tag_id}`
        : (r: FakeTableRow) => r.id as string
      state.tables[tableName].set(keyFn(row), row)
      return row
    },
  }
}