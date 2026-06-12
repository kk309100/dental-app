// Web Audio API によるビープ音ユーティリティ
// QRコード・バーコードスキャン時の音響フィードバック用

type BeepType = "success" | "error"

/**
 * スキャン成功時: 高め短音 (880Hz, 80ms)
 * スキャン失敗時: 低め 2連音 (440Hz, 100ms×2)
 */
export function playBeep(type: BeepType = "success"): void {
  if (typeof window === "undefined") return
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    if (!ctx) return

    if (type === "success") {
      _tone(ctx, 880, 0.08, 0, 0.08)   // 880Hz, 80ms
    } else {
      _tone(ctx, 440, 0.10, 0, 0.10)   // 440Hz, 100ms
      _tone(ctx, 380, 0.10, 0.15, 0.10) // 380Hz, 100ms (150ms後)
    }

    // 再生完了後 AudioContext を閉じる（メモリリーク防止）
    setTimeout(() => {
      try { ctx.close() } catch (_) {}
    }, 500)
  } catch (_) {
    // AudioContext 非対応環境では無視
  }
}

function _tone(
  ctx: AudioContext,
  freq: number,
  gain: number,
  startOffset: number,
  duration: number
) {
  const osc = ctx.createOscillator()
  const vol = ctx.createGain()

  osc.type = "sine"
  osc.frequency.value = freq
  vol.gain.value = gain

  osc.connect(vol)
  vol.connect(ctx.destination)

  const t = ctx.currentTime + startOffset
  osc.start(t)
  osc.stop(t + duration)
}
