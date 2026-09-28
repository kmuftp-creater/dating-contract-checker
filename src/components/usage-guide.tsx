import { FileCheck2, ListChecks, ShieldQuestion, Upload } from 'lucide-react';

/**
 * 首頁的使用說明。
 *
 * 這一段的重點不是教人怎麼按按鈕，而是講清楚「這份報告憑什麼這樣判」：
 * 依據哪一份官方文件、判定分成哪幾種、哪些事情它做不到。
 * 使用者拿到一份寫著「不符合」的報告時，需要知道那個結論的來源。
 */

const STEPS = [
  {
    icon: Upload,
    title: '一、放進合約',
    body: '上傳照片、PDF、Word、Excel 或純文字檔，也可以直接把條文貼進來。',
  },
  {
    icon: ListChecks,
    title: '二、逐條比對',
    body: '系統依「縣市年交友媒合服務定型化契約查核表」的每一個查核項目，一項一項檢查您的合約，並引用內政部公告的條文作為判斷依據。',
  },
  {
    icon: FileCheck2,
    title: '三、只看要改的地方',
    body: '報告會列出全部查核項目，但只有判定為不符合或建議修正的項目才會給改善方式。符合的項目不會多給任何建議。',
  },
];

const VERDICTS = [
  { name: '符合', color: 'text-ok', body: '合約中找得到對應內容，且寫法符合規定。' },
  { name: '不符合', color: 'text-danger', body: '合約中缺少該項目，或寫法違反規定。' },
  {
    name: '建議修正',
    color: 'text-warn',
    body: '形式上有寫，但寫法不足。例如有審閱期間的欄位，卻沒有寫明「至少三日」。',
  },
  { name: '不適用', color: 'text-ink-muted', body: '合約未提供該項服務，例如未販售影音課程。' },
];

export function UsageGuide() {
  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold text-ink">使用說明</h2>

      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        本工具<strong className="text-ink">免費提供、不需註冊</strong>，
        依據內政部公告的{' '}
        <strong className="text-ink">「縣市年交友媒合服務定型化契約查核表」</strong>
        ，逐條檢查您的交友媒合服務契約，找出違反規定的地方並說明如何修改。
        判斷所引用的條文來自內政部 115 年 5 月 8 日公告、自 115 年 9 月 1 日生效的
        「交友媒合服務定型化契約應記載及不得記載事項」。
        兩份文件的實際內容可在「法規文件」頁查看，官方版本請以官方網站為準。
      </p>

      {/*
        適用範圍放在最前面而不是塞進下方的注意事項清單：拿舊合約來檢核會得到
        一份用錯標準的報告，那比沒有報告更糟，所以必須在使用者上傳之前就看到。
      */}
      <div className="mt-4 rounded-(--radius-control) border-2 border-warn/50 bg-warn/10 p-4">
        <p className="text-sm font-semibold text-ink">適用範圍</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink">
          本工具僅檢核
          <strong>115 年 9 月 1 日（含）以後簽訂</strong>的交友合約。
          在那之前簽訂的合約，仍應依照<strong>當時有效的法規標準</strong>辦理，
          用本工具得到的結果不適用於那些合約。
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.title} className="rounded-(--radius-control) border border-hairline p-4">
            <p className="flex items-center gap-2 font-medium text-ink">
              <step.icon className="size-4 text-brand" aria-hidden />
              {step.title}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{step.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-(--radius-control) border border-info/40 bg-info/10 p-4">
        <p className="text-sm font-medium text-ink">合約拆成好幾份的時候</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          一份完整的契約常常不只一個檔案。例如「服務合約書」加上「消費借貸告知確認書」，
          那是兩份文件，但它們合起來才是一份完整的契約。
          這種情況請<strong className="text-ink">一次把全部檔案放進來</strong>，
          分析模式維持<strong className="text-ink">「合併為一份合約」</strong>，
          系統才會把它們當成同一份契約通盤檢查。
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          分開上傳或選成「各檔獨立分析」的話，每個檔案會各自被當成一份完整契約來檢查，
          於是本來寫在另一個檔案裡的條款會被判成「缺漏」，報告就會出現一堆假的不符合。
        </p>
      </div>

      <div className="mt-6">
        <p className="text-sm font-medium text-ink">報告的四種判定</p>
        <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
          {VERDICTS.map((verdict) => (
            <li key={verdict.name}>
              <span className={`font-medium ${verdict.color}`}>{verdict.name}</span>
              <span className="mx-1.5">：</span>
              {verdict.body}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 rounded-(--radius-control) border border-warn/40 bg-warn/10 p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <ShieldQuestion className="size-4 text-warn" aria-hidden />
          請留意這幾件事
        </p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-muted">
          <li>
            本工具的判定由 AI 產生，屬於自行檢查用的參考，
            <strong className="text-ink">不等於主管機關的查核結果</strong>，也不構成法律意見。
            <strong className="text-ink">一切以內政部與地方主管機關公告的內容及其認定為準。</strong>
          </li>
          <li>
            照片拍得太模糊、PDF 是掃描檔而字跡不清時，可能有條文沒被讀到。
            報告上方若出現提醒文字，請一併確認。
          </li>
          <li>
            本工具檢核的是
            <strong className="text-ink">115 年 9 月 1 日（含）以後簽訂的交友合約</strong>。
            在那之前簽訂的合約，仍應按照當時有效的法規標準辦理，
            用本工具檢核的結果不適用於那些合約。
          </li>
          <li>法規會修訂。報告會標示當時依據的版本，舊報告不代表最新規定。</li>
          <li>
            本站<strong className="text-ink">只檢查交友媒合服務契約</strong>。
            上傳其他類型的文件會被擋下並顯示提醒，該次不計入您的每日次數；
            反覆上傳非交友合約會被暫停使用，再犯則會被封鎖。
            若您認為是誤判，請用下方的「問題回報」告訴我們。
          </li>
          <li>
            上傳的內容僅供本次分析與您自己的歷史紀錄使用。請避免上傳與查核無關的個人資料。
          </li>
        </ul>
      </div>
    </section>
  );
}
