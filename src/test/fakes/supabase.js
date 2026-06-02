/**
 * Supabase mock：返回带 auth / from / channel 等接口的 fake 对象
 * - 状态保存在闭包内，测试用例自己控制
 * - 默认行为：成功返回空数据
 */
export const createFakeSupabase = (overrides = {}) => {
  const state = {
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

  const okResult = (data) => ({ data, error: null, status: 200, statusText: 'OK' })
  const errResult = (msg) => ({
    data: null,
    error: { message: msg || state.failMessage },
    status: 400,
    statusText: 'Bad Request',
  })

  const wrap = (fn) => async (...args) => {
    if (state.failNext) {
      state.failNext = false
      return errResult()
    }
    try {
      return await fn(...args)
    } catch (e) {
      return errResult(e.message)
    }
  }

  const table = (name) => ({
    select() {
      const self = this
      return {
        gt() {
          return {
            order() {
              return wrap(async () => {
                const all = [...state.tables[name].values()]
                return all
              })()
            },
            async then(resolve) {
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
        async then(resolve) {
          resolve(okResult([...state.tables[name].values()]))
        },
      }
    },
    insert(rows) {
      return wrap(async () => {
        const arr = Array.isArray(rows) ? rows : [rows]
        for (const r of arr) {
          state.tables[name].set(r.id, r)
        }
        return arr
      })()
    },
    upsert(rows, opts) {
      return wrap(async () => {
        const arr = Array.isArray(rows) ? rows : [rows]
        for (const r of arr) {
          const keyFn = name === 'note_tags' ? (r) => `${r.note_id}:${r.tag_id}` : (r) => r.id
          const k = keyFn(r)
          // 按 onConflict 决定行为
          state.tables[name].set(k, r)
        }
        return arr
      })()
    },
    update(patch) {
      return {
        eq(col, val) {
          return wrap(async () => {
            let updated = null
            for (const r of state.tables[name].values()) {
              if (r[col] === val) {
                const merged = { ...r, ...patch }
                state.tables[name].set(r.id, merged)
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
        eq(col, val) {
          return wrap(async () => {
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
      async signInWithPassword({ email, password }) {
        if (state.failNext) {
          state.failNext = false
          return { data: null, error: { message: state.failMessage } }
        }
        const user = { id: 'user-1', email }
        state.user = user
        return { data: { user, session: { user } }, error: null }
      },
      async signUp({ email, password }) {
        if (state.failNext) {
          state.failNext = false
          return { data: null, error: { message: state.failMessage } }
        }
        const user = { id: 'user-1', email }
        state.user = user
        return { data: { user, session: { user } }, error: null }
      },
      async signOut() {
        state.user = null
        return { error: null }
      },
      onAuthStateChange(handler) {
        return {
          data: { subscription: { unsubscribe() {} } },
        }
      },
    },
    from(name) {
      if (!state.tables[name]) state.tables[name] = new Map()
      return table(name)
    },
    channel(name) {
      const handlers = []
      return {
        on(_evt, filter, handler) {
          handlers.push({ filter, handler })
          state.realtimeHandlers.push({ channel: name, filter, handler })
          return this
        },
        subscribe(cb) {
          if (cb) cb('SUBSCRIBED')
          return this
        },
        unsubscribe() {},
        _trigger(event, payload) {
          for (const h of handlers) h.handler(payload)
        },
      }
    },
    /** 测试用工具 */
    _setUser(user) {
      state.user = user
    },
    _failNext(msg) {
      state.failNext = true
      state.failMessage = msg
    },
    _putRow(tableName, row) {
      if (!state.tables[tableName]) state.tables[tableName] = new Map()
      const keyFn = tableName === 'note_tags' ? (r) => `${r.note_id}:${r.tag_id}` : (r) => r.id
      state.tables[tableName].set(keyFn(row), row)
    },
  }
}
