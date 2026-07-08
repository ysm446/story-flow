import { exec } from 'node:child_process'
import os from 'node:os'
import { BrowserWindow } from 'electron'
import type { SystemResources } from './types'

// lm-graph から移植: CPU は os.cpus() の差分、GPU/VRAM は nvidia-smi（無ければ非表示）

type CpuSample = Array<{ idle: number; total: number }>

function sampleCpus(): CpuSample {
  return os.cpus().map((cpu) => {
    const times = cpu.times
    const total = (Object.values(times) as number[]).reduce((a, b) => a + b, 0)
    return { idle: times.idle, total }
  })
}

function computeCpuUsage(prev: CpuSample, curr: CpuSample): number {
  let idleDiff = 0
  let totalDiff = 0
  for (let i = 0; i < Math.min(prev.length, curr.length); i += 1) {
    idleDiff += curr[i].idle - prev[i].idle
    totalDiff += curr[i].total - prev[i].total
  }
  if (totalDiff <= 0) return 0
  return ((totalDiff - idleDiff) / totalDiff) * 100
}

type GpuInfo = { gpuUsage: number | null; vramUsed: number | null; vramTotal: number | null }

let nvidiaSmiAvailable: boolean | null = null

function queryNvidiaSmi(): Promise<GpuInfo> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ gpuUsage: null, vramUsed: null, vramTotal: null }), 3000)
    exec(
      'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits',
      (err, stdout) => {
        clearTimeout(timeout)
        if (err || !stdout) {
          nvidiaSmiAvailable = false
          resolve({ gpuUsage: null, vramUsed: null, vramTotal: null })
          return
        }
        const parts = stdout.trim().split('\n')[0].split(',').map((s) => parseFloat(s.trim()))
        if (parts.length >= 3 && parts.every((n) => !isNaN(n))) {
          nvidiaSmiAvailable = true
          resolve({ gpuUsage: parts[0], vramUsed: parts[1], vramTotal: parts[2] })
        } else {
          nvidiaSmiAvailable = false
          resolve({ gpuUsage: null, vramUsed: null, vramTotal: null })
        }
      }
    )
  })
}

export function startSystemResourcePolling(): () => void {
  let cpuSample = sampleCpus()
  let cachedGpuInfo: GpuInfo = { gpuUsage: null, vramUsed: null, vramTotal: null }
  let gpuQueryInFlight = false

  const refreshGpu = (): void => {
    if (gpuQueryInFlight || nvidiaSmiAvailable === false) return
    gpuQueryInFlight = true
    void queryNvidiaSmi().then((info) => {
      cachedGpuInfo = info
      gpuQueryInFlight = false
    })
  }
  refreshGpu()

  const interval = setInterval(() => {
    const prevSample = cpuSample
    const currSample = sampleCpus()
    cpuSample = currSample

    const totalMem = os.totalmem()
    const payload: SystemResources = {
      cpuUsage: Math.round(computeCpuUsage(prevSample, currSample)),
      ramUsed: totalMem - os.freemem(),
      ramTotal: totalMem,
      gpuUsage: cachedGpuInfo.gpuUsage,
      vramUsed: cachedGpuInfo.vramUsed,
      vramTotal: cachedGpuInfo.vramTotal
    }

    refreshGpu()

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('system:resources', payload)
    }
  }, 1000)

  return () => clearInterval(interval)
}
