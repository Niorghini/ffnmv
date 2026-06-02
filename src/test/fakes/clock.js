/**
 * 可控时钟：测试时把 Date.now / new Date 锁在固定起点，可手动 advance(ms)
 * 用法：
 *   const clock = createFakeClock(new Date('2026-01-01T00:00:00Z'))
 *   clock.install()
 *   ... do stuff ...
 *   clock.advance(1000)  // +1s
 *   clock.uninstall()
 */
export const createFakeClock = (startDate) => {
  let offset = 0
  const realNow = startDate.getTime()
  return {
    install() {
      const RealDate = Date
      // @ts-ignore
      globalThis.Date = class extends RealDate {
        constructor(...args) {
          if (args.length === 0) {
            super(realNow + offset)
          } else {
            // @ts-ignore
            super(...args)
          }
        }
        static now() {
          return realNow + offset
        }
      }
    },
    advance(ms) {
      offset += ms
    },
    uninstall() {
      // jsdom 不支持简单恢复 globalThis.Date；测试间用 vi.useFakeTimers 更稳
    },
    now() {
      return new Date(realNow + offset)
    },
  }
}
