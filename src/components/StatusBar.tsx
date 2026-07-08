import { useEffect, useState } from 'react'
import type { SystemResources } from '../../electron/main/types'
import { useUiSettings } from '../store/settings'
import { IconActivity } from './icons'

function fmtBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)}G` : `${(bytes / 1024 ** 2).toFixed(0)}M`
}

function fmtMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}G` : `${mb.toFixed(0)}M`
}

function ResourceBar({ label, pct, detail }: { label: string; pct: number; detail: string }) {
  const clampedPct = Math.min(100, Math.max(0, pct))
  const barColor = clampedPct > 85 ? 'var(--danger)' : clampedPct > 65 ? '#f97316' : 'var(--accent)'
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-medium text-[var(--text-faint)]">{label}</span>
      <div className="h-[3px] w-10 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${clampedPct}%`, backgroundColor: barColor }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-[var(--text-dim)]">{detail}</span>
    </div>
  )
}

/**
 * 下部ステータスバー。右端にシステムリソース（CPU/RAM/GPU/VRAM）と表示オンオフ。
 * リソース値は Electron main が 1 秒ごとに push する（lm-graph から移植）。
 */
export function StatusBar({ backendHealthy, modelLabel }: { backendHealthy: boolean; modelLabel: string }) {
  const { settings, updateSettings } = useUiSettings()
  const [res, setRes] = useState<SystemResources | null>(null)

  useEffect(() => {
    return window.storyFlow.onSystemResources((payload) => setRes(payload))
  }, [])

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-[var(--border)] bg-[var(--bg-sidebar)] px-3">
      {/* 左: 接続状態 */}
      <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-faint)]">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${backendHealthy ? 'bg-[var(--ok)]' : 'bg-[var(--danger)]'}`} />
        backend
      </span>
      <span className="max-w-[280px] truncate text-[11px] text-[var(--text-faint)]">{modelLabel}</span>

      {/* 右: システムリソース + オンオフ */}
      <div className="ml-auto flex items-center gap-3">
        {settings.statusMonitorVisible && res && (
          <>
            <ResourceBar label="CPU" pct={res.cpuUsage} detail={`${res.cpuUsage}%`} />
            <ResourceBar
              label="RAM"
              pct={(res.ramUsed / res.ramTotal) * 100}
              detail={`${fmtBytes(res.ramUsed)}/${fmtBytes(res.ramTotal)}`}
            />
            {res.gpuUsage !== null && <ResourceBar label="GPU" pct={res.gpuUsage} detail={`${res.gpuUsage}%`} />}
            {res.vramUsed !== null && res.vramTotal !== null && (
              <ResourceBar
                label="VRAM"
                pct={(res.vramUsed / res.vramTotal) * 100}
                detail={`${fmtMb(res.vramUsed)}/${fmtMb(res.vramTotal)}`}
              />
            )}
          </>
        )}
        <button
          onClick={() => updateSettings({ statusMonitorVisible: !settings.statusMonitorVisible })}
          aria-label={settings.statusMonitorVisible ? 'リソース表示をオフ' : 'リソース表示をオン'}
          title={settings.statusMonitorVisible ? 'リソース表示をオフ' : 'リソース表示をオン'}
          className={`flex items-center rounded px-1.5 py-0.5 hover:bg-[var(--bg-elevated)] ${
            settings.statusMonitorVisible ? 'text-[var(--text-dim)]' : 'text-[var(--text-faint)] opacity-60'
          }`}
        >
          <IconActivity size={13} />
        </button>
      </div>
    </footer>
  )
}
