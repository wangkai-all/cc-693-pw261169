export interface SampleMeta {
  id: string;
  title: string;
  description: string;
  initialCols: number;
  initialRows: number;
  frames: number;
  bytes: number;
  features: string[];
  createdAt: string;
}

export async function processSample(sampleId: string): Promise<unknown> {
  const resp = await fetch(`/api/samples/${encodeURIComponent(sampleId)}/process`);
  if (!resp.ok) throw new Error(`处理失败: ${resp.status}`);
  return resp.json();
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  triggerDownload(URL.createObjectURL(blob), filename);
}

export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  triggerDownload(URL.createObjectURL(blob), filename);
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
