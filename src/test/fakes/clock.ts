/**
 * 可控时钟：测试时把 Date.now / new Date 锁在固定起点，可手动 advance(ms)
 * 用法：
 *   const clock = createFakeClock(new Date('2026-01-01T00:00:00Z'))
 *   clock.install()
 *   ... do stuff ...
 *   clock.advance(1000)  // +1s
 *   clock.uninstall()
 */
export interface FakeClock {
  install: () => void
  advance: (ms: number) => void
  uninstall: () => void
  now: () => Date
}

export const createFakeClock = (startDate: Date): FakeClock => {
  let offset = 0
  const realNow = startDate.getTime()
  return {
    install(): void {
      const RealDate = Date
      // 覆盖 globalThis.Date 用于测试 fakeClock
      globalThis.Date = class extends RealDate {
        constructor(...args: ConstructorParameters<typeof Date>) {
          // args.length === 0 表示无参调用（new Date()），用 fixedNow + offset
          // 否则正常转发（new Date(string)、new Date(year, month, ...) 等）
          if (args.length > 0) {
            super(...args)
          } else {
            super(realNow + offset)
          }
          return
        }
        static now(): number {
          return realNow + offset
        }
      } as unknown as DateConstructor
    },
    advance(ms: number): void {
      offset += ms
    },
    uninstall(): void {
      // jsdom 不支持简单恢复 globalThis.Date；测试间用 vi.useFakeTimers 更稳
    },
    now(): Date {
      return new Date(realNow + offset)
    },
  }
}