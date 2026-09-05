import type { AnalysisFileSummary } from '@/lib/api-contract';
import type { AnalysisMode, AnalysisResult, CheckStatus, ExtractMethod } from '@/lib/types';

/**
 * 分析結果的純文字報告。
 *
 * 「複製結果」與「下載 TXT」共用這裡的 `buildReportText`：只用純文字排版
 * （不含 markdown 符號），確保在終端機、記事本這類最陽春的檢視器打開也
 * 好讀。判定為符合或不適用時不印改善方式，理由是這兩種判定本來就沒有
 * 需要改善的地方，硬印出來只會讓報告變長又沒有資訊量。
 */

export interface ReportTextInput {
  createdAt: string;
  finishedAt: string | null;
  mode: AnalysisMode;
  files: AnalysisFileSummary[];
  checklistVersion: number | null;
  regulationVersion: number | null;
  result: AnalysisResult;
}

const MODE_LABEL: Record<AnalysisMode, string> = {
  merged: '合併為一份合約',
  separate: '各檔獨立分析',
};

const EXTRACT_METHOD_LABEL: Record<ExtractMethod, string> = {
  text: '文字抽取',
  ocr: '影像辨識',
};

const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: '符合',
  fail: '不符合',
  fix: '建議修正',
  na: '不適用',
};

const DISCLAIMER =
  '免責說明：本報告由 AI 產生，屬自行檢查用的參考，不等於主管機關的查核結果。';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-Hant-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 產出報告的純文字全文。 */
export function buildReportText(input: ReportTextInput): string {
  const { result } = input;
  const lines: string[] = [];

  lines.push('交友媒合服務定型化契約健檢報告');
  lines.push('');
  lines.push(`分析時間：${formatDateTime(input.createdAt)}`);
  if (input.finishedAt) {
    lines.push(`完成時間：${formatDateTime(input.finishedAt)}`);
  }
  lines.push(`分析模式：${MODE_LABEL[input.mode]}`);
  if (input.checklistVersion !== null || input.regulationVersion !== null) {
    lines.push(
      `依據版本：查核表第 ${input.checklistVersion ?? '－'} 版、公告全文第 ${
        input.regulationVersion ?? '－'
      } 版`,
    );
  }

  if (input.files.length > 0) {
    lines.push('');
    lines.push('檔案清單：');
    input.files.forEach((file, index) => {
      lines.push(
        `　${index + 1}. ${file.name}（${formatSize(file.size)}，${
          EXTRACT_METHOD_LABEL[file.extractMethod]
        }，共 ${file.pageCount} 頁）`,
      );
    });
  }

  lines.push('');
  lines.push(
    `統計：符合 ${result.summary.pass} 項、不符合 ${result.summary.fail} 項、建議修正 ${result.summary.fix} 項、不適用 ${result.summary.na} 項`,
  );

  if (result.notes) {
    lines.push('');
    lines.push(`備註：${result.notes}`);
  }

  lines.push('');
  lines.push('＝＝＝＝＝＝＝＝＝＝ 查核項目明細 ＝＝＝＝＝＝＝＝＝＝');

  result.items.forEach((item) => {
    lines.push('');
    lines.push(`第 ${item.id} 項　${item.title}`);
    lines.push(`判定：${STATUS_LABEL[item.status]}`);
    lines.push(`合約現況：${item.evidence || '（無對應內容）'}`);
    if (item.status === 'fail' || item.status === 'fix') {
      lines.push(`改善方式：${item.fix || '（無）'}`);
    }
    lines.push('－－－－－－－－－－－－－－－－－－－－');
  });

  lines.push('');
  lines.push(DISCLAIMER);

  return lines.join('\n');
}

/** 檔案系統不允許出現在檔名裡的字元。 */
const FORBIDDEN_FILENAME_CHARS = /[\\/:*?"<>|]/g;

/**
 * 產出下載用的檔名，例如 `交友合約健檢_20260905_f21a1d08.txt`。
 * 日期一律以台北時區為準，分析編號只取前八碼。
 */
export function buildReportFilename(date: Date, analysisId: string): string {
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replace(/-/g, '');
  const idPart = analysisId.slice(0, 8).replace(FORBIDDEN_FILENAME_CHARS, '');
  return `交友合約健檢_${datePart}_${idPart}.txt`;
}
