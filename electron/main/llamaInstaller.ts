import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  LlamaBackendFamily,
  LlamaInstallProgress,
  LlamaRelease,
  LlamaReleaseVariant
} from './types'

const RELEASES_API = 'https://api.github.com/repos/ggml-org/llama.cpp/releases'
const USER_AGENT = 'story-flow'

interface GithubAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GithubRelease {
  tag_name: string
  name: string | null
  published_at: string | null
  html_url: string
  prerelease: boolean
  draft: boolean
  assets: GithubAsset[]
}

// llama-bXXXX-bin-win-<backend>-x64.zip
const LLAMA_ASSET_RE = /^llama-(b\d+)-bin-win-(.+)-x64\.zip$/i
// cudart-llama-bin-win-cuda-<version>-x64.zip
const CUDART_ASSET_RE = /^cudart-llama-bin-win-cuda-(.+)-x64\.zip$/i

export async function fetchLlamaReleases(limit = 8, signal?: AbortSignal): Promise<LlamaRelease[]> {
  const response = await fetch(`${RELEASES_API}?per_page=${Math.min(Math.max(limit, 1), 30)}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
    signal
  })
  if (!response.ok) {
    const reason = response.status === 403 ? ' (GitHub API rate limit may have been reached)' : ''
    throw new Error(`Failed to fetch llama.cpp releases: ${response.status}${reason}`)
  }
  const payload = (await response.json()) as GithubRelease[]
  return payload
    .filter((release) => !release.draft)
    .map((release) => buildRelease(release))
    .filter((release): release is LlamaRelease => release !== null && release.variants.length > 0)
}

function buildRelease(release: GithubRelease): LlamaRelease | null {
  const cudartAssets = release.assets
    .map((asset) => {
      const match = asset.name.match(CUDART_ASSET_RE)
      return match ? { version: match[1].toLowerCase(), asset } : null
    })
    .filter((entry): entry is { version: string; asset: GithubAsset } => entry !== null)

  const variants: LlamaReleaseVariant[] = []
  for (const asset of release.assets) {
    const match = asset.name.match(LLAMA_ASSET_RE)
    if (!match) continue
    const backend = match[2].toLowerCase()
    const family = backendFamily(backend)
    const cudart = family === 'cuda' ? matchCudart(backend, cudartAssets) : null
    variants.push({
      key: `${release.tag_name}:${backend}`,
      label: backendLabel(backend),
      family,
      assetName: asset.name,
      assetUrl: asset.browser_download_url,
      sizeBytes: asset.size,
      cudartName: cudart?.asset.name ?? null,
      cudartUrl: cudart?.asset.browser_download_url ?? null,
      cudartSizeBytes: cudart?.asset.size ?? null
    })
  }

  variants.sort((left, right) => familyRank(left.family) - familyRank(right.family) || left.label.localeCompare(right.label))

  return {
    tag: release.tag_name,
    name: release.name ?? release.tag_name,
    publishedAt: release.published_at,
    htmlUrl: release.html_url,
    variants
  }
}

function matchCudart(
  backend: string,
  cudartAssets: Array<{ version: string; asset: GithubAsset }>
): { version: string; asset: GithubAsset } | null {
  if (cudartAssets.length === 0) return null
  const version = backend.replace(/^cuda-?/, '')
  return cudartAssets.find((entry) => entry.version === version) ?? cudartAssets[0]
}

function backendFamily(backend: string): LlamaBackendFamily {
  if (backend.startsWith('cuda')) return 'cuda'
  if (backend.startsWith('cpu')) return 'cpu'
  if (backend.startsWith('vulkan')) return 'vulkan'
  if (backend.startsWith('hip') || backend.includes('radeon') || backend.includes('rocm')) return 'hip'
  if (backend.startsWith('sycl')) return 'sycl'
  return 'other'
}

// 既定の選択優先度: CUDA を最優先
function familyRank(family: LlamaBackendFamily): number {
  const order: LlamaBackendFamily[] = ['cuda', 'vulkan', 'hip', 'sycl', 'cpu', 'other']
  const index = order.indexOf(family)
  return index === -1 ? order.length : index
}

function backendLabel(backend: string): string {
  if (backend.startsWith('cuda')) {
    const version = backend.replace(/^cuda-?/, '')
    return version ? `CUDA ${version} (NVIDIA)` : 'CUDA (NVIDIA)'
  }
  if (backend === 'cpu') return 'CPU'
  if (backend.startsWith('cpu')) return `CPU (${backend.replace(/^cpu-?/, '')})`
  if (backend.startsWith('vulkan')) return 'Vulkan'
  if (backend.startsWith('sycl')) return 'SYCL (Intel)'
  if (backend.startsWith('hip') || backend.includes('radeon')) return 'HIP / ROCm (AMD)'
  return backend
}

export async function installLlamaVariant(input: {
  runtimeDir: string
  variant: LlamaReleaseVariant
  onProgress: (progress: LlamaInstallProgress) => void
  signal: AbortSignal
}): Promise<{ build: string | null; path: string }> {
  const { runtimeDir, variant, onProgress, signal } = input
  const destDir = join(runtimeDir, variant.assetName.replace(/\.zip$/i, ''))
  const tempFiles: string[] = []

  try {
    await mkdir(runtimeDir, { recursive: true })
    await mkdir(destDir, { recursive: true })

    const serverZip = join(tmpdir(), `story-flow-${randomUUID()}.zip`)
    tempFiles.push(serverZip)
    await downloadFile(variant.assetUrl, serverZip, 'llama-server', onProgress, signal)
    onProgress({ phase: 'extract', fileLabel: variant.assetName })
    await extractZip(serverZip, destDir)

    if (variant.cudartUrl) {
      const cudartZip = join(tmpdir(), `story-flow-${randomUUID()}.zip`)
      tempFiles.push(cudartZip)
      await downloadFile(variant.cudartUrl, cudartZip, 'CUDA runtime', onProgress, signal)
      onProgress({ phase: 'extract', fileLabel: variant.cudartName ?? 'CUDA runtime' })
      await extractZip(cudartZip, destDir)
    }

    const serverPath = join(destDir, 'llama-server.exe')
    if (!existsSync(serverPath)) {
      throw new Error('llama-server.exe was not found in the downloaded archive.')
    }
    const build = variant.assetName.match(/(b\d+)/i)?.[1].toLowerCase() ?? null
    onProgress({ phase: 'done', build, path: serverPath })
    return { build, path: serverPath }
  } finally {
    await Promise.allSettled(tempFiles.map((file) => rm(file, { force: true })))
  }
}

async function downloadFile(
  url: string,
  destPath: string,
  label: string,
  onProgress: (progress: LlamaInstallProgress) => void,
  signal: AbortSignal
): Promise<void> {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${label}): ${response.status}`)
  }
  const totalHeader = Number(response.headers.get('content-length'))
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null
  const reader = response.body.getReader()
  const fileStream = createWriteStream(destPath)
  let received = 0
  onProgress({ phase: 'download', fileLabel: label, received: 0, total, percent: total ? 0 : null })

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.length
      await new Promise<void>((resolve, reject) => {
        fileStream.write(Buffer.from(value), (error) => (error ? reject(error) : resolve()))
      })
      onProgress({
        phase: 'download',
        fileLabel: label,
        received,
        total,
        percent: total ? Math.round((received / total) * 100) : null
      })
    }
  } finally {
    await new Promise<void>((resolve) => fileStream.end(() => resolve()))
  }
}

function extractZip(zipPath: string, destDir: string): Promise<void> {
  // Windows 10/11 には bsdtar が同梱されており .zip を展開できる
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xf', zipPath, '-C', destDir], { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (data) => {
      stderr += String(data)
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Extraction failed (tar exited with ${code}): ${stderr.trim()}`))
    })
  })
}
