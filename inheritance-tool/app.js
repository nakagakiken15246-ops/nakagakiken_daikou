/* ============================================================
   相続税申告 初回面談支援ツール
   - データはすべてこの端末のブラウザ内(localStorage)に保存されます。
   - 外部通信は一切行いません（オフラインで動作します）。
   ============================================================ */
(function () {
  "use strict";

  var STORAGE_KEY = "inheritanceInterviewTool.v1.cases";

  /* ---------------------------------------------------------
     マスタデータ
  --------------------------------------------------------- */
  var RELATIONSHIP_OPTIONS = [
    { value: "spouse",        label: "配偶者",             tier: 0 },
    { value: "child_natural", label: "子（実子）",         tier: 1 },
    { value: "child_adopted", label: "子（養子）",         tier: 1 },
    { value: "child_in_law",  label: "子の配偶者（参考）", tier: 1 },
    { value: "grandchild",    label: "孫（代襲相続人）",   tier: 2 },
    { value: "father",        label: "父",                 tier: -1 },
    { value: "mother",        label: "母",                 tier: -1 },
    { value: "grandfather",   label: "祖父",               tier: -2 },
    { value: "grandmother",   label: "祖母",               tier: -2 },
    { value: "sibling",       label: "兄弟姉妹",           tier: 0 },
    { value: "niece_nephew",  label: "甥・姪（代襲相続人）", tier: 1 },
    { value: "other",         label: "その他（参考情報）", tier: 0 }
  ];
  var REL_MAP = {};
  RELATIONSHIP_OPTIONS.forEach(function (r) { REL_MAP[r.value] = r; });

  var TIER_LABELS = { "-2": "祖父母", "-1": "父母", "0": "被相続人・配偶者・兄弟姉妹", "1": "子・子の配偶者・甥姪", "2": "孫" };
  var TIER_ORDER = [-2, -1, 0, 1, 2];

  var STATUS_LABELS = {
    alive: "存命", deceased: "死亡", renounced: "相続放棄", disqualified: "欠格・廃除"
  };

  var HEARING_ITEMS = [
    { key: "will", q: "遺言書の有無", options: ["未確認", "無し", "有り（自筆証書）", "有り（公正証書）", "有り（その他）"] },
    { key: "seisanka", q: "相続時精算課税制度の利用", options: ["未確認", "無し", "有り"] },
    { key: "gift", q: "生前贈与（直近数年）の有無", options: ["未確認", "無し", "有り"] },
    { key: "insurance", q: "死亡保険金・死亡退職金の有無", options: ["未確認", "無し", "有り"] },
    { key: "realestate", q: "不動産（自宅・収益物件・農地等）の有無", options: ["未確認", "無し", "有り"] },
    { key: "business", q: "事業承継・自社株の有無", options: ["未確認", "無し", "有り"] },
    { key: "relationship", q: "相続人間の関係性・留意点", options: ["良好", "要注意", "不明"] },
    { key: "policy", q: "遺産分割の方針・ご希望", options: ["未定", "おおよそ決まっている", "決まっている"] }
  ];

  var DEFAULT_DOCS = [
    "戸籍謄本一式（出生～死亡）", "住民票（除票）・戸籍の附票", "印鑑証明書（相続人全員）",
    "固定資産評価証明書", "名寄帳", "預金残高証明書・取引履歴", "証券残高証明書",
    "生命保険金支払通知書・保険証券", "債務・借入金の残高証明書", "葬式費用の領収書",
    "過去の贈与関連資料", "遺言書・遺産分割協議書（あれば）"
  ];
  var DOC_STATUS_OPTIONS = ["未依頼", "依頼済", "取得済", "対象外"];

  var ASSET_CATEGORIES = [
    { key: "land", label: "土地", sign: 1 },
    { key: "building", label: "家屋・構築物", sign: 1 },
    { key: "cash", label: "現金・預貯金", sign: 1 },
    { key: "securities", label: "有価証券（株式・投資信託等）", sign: 1 },
    { key: "insurance", label: "生命保険金等", sign: 1 },
    { key: "retirement", label: "死亡退職金等", sign: 1 },
    { key: "business_assets", label: "事業用資産・自社株", sign: 1 },
    { key: "other_assets", label: "家庭用財産・その他の財産", sign: 1 },
    { key: "debt", label: "債務（借入金等）", sign: -1 },
    { key: "funeral", label: "葬式費用", sign: -1 }
  ];
  var ASSET_CAT_MAP = {};
  ASSET_CATEGORIES.forEach(function (c) { ASSET_CAT_MAP[c.key] = c; });

  var REFERRAL_OPTIONS = [
    { value: "flyer_free", label: "無料相談会折込チラシ", hasDetail: true, detailPlaceholder: "配布月（例：8月）" },
    { value: "flyer_other", label: "その他のチラシ", hasDetail: true, detailPlaceholder: "チラシ名等" },
    { value: "seminar", label: "セミナー", hasDetail: true, detailPlaceholder: "開催日（例：2026/8/1）" },
    { value: "hp", label: "ホームページ", hasDetail: false },
    { value: "walkin", label: "飛び込み", hasDetail: false },
    { value: "referral", label: "ご紹介", hasDetail: true, detailPlaceholder: "紹介者名等" },
    { value: "other", label: "その他", hasDetail: true, detailPlaceholder: "内容" }
  ];
  var REFERRAL_MAP = {};
  REFERRAL_OPTIONS.forEach(function (r) { REFERRAL_MAP[r.value] = r; });

  var CONSULTATION_TYPES = [
    "相続税申告", "相続手続き", "相続税試算", "贈与税", "生前贈与", "遺言",
    "不動産名変", "不動産売買", "家族信託", "相続人間紛争", "確定申告"
  ];

  var LIVING_TOGETHER_LABELS = { unknown: "未確認", yes: "同居している", no: "同居していない" };

  /* ---------------------------------------------------------
     ユーティリティ
  --------------------------------------------------------- */
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = b; b = a % b; a = t; } return a || 1; }
  function frac(num, den) { if (den === 0) return { num: 0, den: 1 }; var g = gcd(num, den); var sign = den < 0 ? -1 : 1; return { num: (num / g) * sign, den: (den / g) * sign }; }
  function fracToStr(f) { if (!f || f.num === 0) return "―"; if (f.den === 1) return f.num + ""; return f.num + "／" + f.den; }
  function formatYen(n) {
    n = Number(n) || 0;
    return n.toLocaleString("ja-JP") + " 円";
  }
  function formatDateJ(s) {
    if (!s) return "";
    var d = new Date(s + "T00:00:00");
    if (isNaN(d.getTime())) return s;
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }
  function addMonths(dateStr, months) {
    var d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    d.setMonth(d.getMonth() + months);
    return d;
  }
  function debounce(fn, wait) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }
  function escapeHtml(s) {
    return (s == null ? "" : String(s)).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === "class") e.className = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  /* ---------------------------------------------------------
     データストア
  --------------------------------------------------------- */
  function loadCases() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("読込エラー", e);
      return [];
    }
  }
  function saveCases(cases) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
  }

  function newCaseSkeleton() {
    var now = Date.now();
    var hearing = {};
    HEARING_ITEMS.forEach(function (h) { hearing[h.key] = { value: h.options[0], memo: "" }; });
    return {
      id: uid(),
      createdAt: now,
      updatedAt: now,
      title: "",
      staff: "",
      contact: { name: "", kana: "", address: "", phone: "", contactTime: "", relation: "", livingTogether: "unknown" },
      referral: { type: "", dmConsent: "", details: {} },
      consultationTypes: [],
      decedent: { name: "", kana: "", birth: "", death: "", address: "", honseki: "", job: "", note: "" },
      interview: {
        date: "", place: "", attendeeStaff: "", attendeeFamily: "",
        hearing: hearing,
        memo: "", nextDate: "", nextMemo: "",
        docs: DEFAULT_DOCS.map(function (name) { return { id: uid(), name: name, status: "未依頼", memo: "" }; })
      },
      people: [],
      assets: []
    };
  }

  /* ---------------------------------------------------------
     状態
  --------------------------------------------------------- */
  var state = {
    cases: loadCases(),
    currentCaseId: null,
    currentTab: "basic"
  };

  function getCase() {
    return state.cases.find(function (c) { return c.id === state.currentCaseId; }) || null;
  }
  function touch(c) { c.updatedAt = Date.now(); }
  function persist() {
    saveCases(state.cases);
    var s = document.getElementById("save-status");
    if (s) s.textContent = "保存済み " + new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }
  var persistDebounced = debounce(persist, 400);

  /* ---------------------------------------------------------
     法定相続人 判定エンジン（簡易版・目安）
  --------------------------------------------------------- */
  function isCandidate(p) { return p.status === "alive" || p.status === "renounced"; }

  function classifyHeirs(people) {
    var spouse = people.filter(function (p) { return p.relationship === "spouse" && isCandidate(p); })[0] || null;
    var children = people.filter(function (p) { return (p.relationship === "child_natural" || p.relationship === "child_adopted") && isCandidate(p); });
    var grandchildren = people.filter(function (p) { return p.relationship === "grandchild" && isCandidate(p); });
    var parents = people.filter(function (p) { return (p.relationship === "father" || p.relationship === "mother") && isCandidate(p); });
    var grandparents = people.filter(function (p) { return (p.relationship === "grandfather" || p.relationship === "grandmother") && isCandidate(p); });
    var siblings = people.filter(function (p) { return p.relationship === "sibling" && isCandidate(p); });
    var nieceNephews = people.filter(function (p) { return p.relationship === "niece_nephew" && isCandidate(p); });

    var rank = 0, groupHeirs = [];
    if (children.length > 0 || grandchildren.length > 0) {
      rank = 1; groupHeirs = children.concat(grandchildren);
    } else if (parents.length > 0 || grandparents.length > 0) {
      rank = 2; groupHeirs = parents.length > 0 ? parents : grandparents;
    } else if (siblings.length > 0 || nieceNephews.length > 0) {
      rank = 3; groupHeirs = siblings.concat(nieceNephews);
    }
    return { spouse: spouse, rank: rank, groupHeirs: groupHeirs };
  }

  function computeShares(people) {
    var c = classifyHeirs(people);
    var spouse = c.spouse, rank = c.rank, groupHeirs = c.groupHeirs;
    var distributable = groupHeirs.filter(function (p) { return p.status === "alive"; });
    var spouseActive = spouse && spouse.status === "alive" ? spouse : null;

    var spouseShare = frac(0, 1), groupShare = frac(0, 1);
    if (spouseActive && distributable.length > 0) {
      if (rank === 1) { spouseShare = frac(1, 2); groupShare = frac(1, 2); }
      else if (rank === 2) { spouseShare = frac(2, 3); groupShare = frac(1, 3); }
      else if (rank === 3) { spouseShare = frac(3, 4); groupShare = frac(1, 4); }
    } else if (spouseActive && distributable.length === 0) {
      spouseShare = frac(1, 1);
    } else if (!spouseActive && distributable.length > 0) {
      groupShare = frac(1, 1);
    }

    var shares = {};
    if (spouse) shares[spouse.id] = spouseActive ? spouseShare : frac(0, 1);
    groupHeirs.forEach(function (p) {
      if (p.status === "alive") {
        shares[p.id] = frac(groupShare.num, groupShare.den * distributable.length);
      } else {
        shares[p.id] = frac(0, 1);
      }
    });
    return { spouse: spouse, rank: rank, groupHeirs: groupHeirs, shares: shares };
  }

  function computeDeductionCount(people) {
    var c = classifyHeirs(people);
    var count = 0;
    if (c.spouse) count += 1;
    if (c.rank === 1) {
      var naturalAndGrandchild = c.groupHeirs.filter(function (p) { return p.relationship === "child_natural" || p.relationship === "grandchild"; }).length;
      var adopted = c.groupHeirs.filter(function (p) { return p.relationship === "child_adopted"; }).length;
      var cap = naturalAndGrandchild > 0 ? 1 : 2;
      count += naturalAndGrandchild + Math.min(adopted, cap);
    } else {
      count += c.groupHeirs.length;
    }
    return count;
  }

  /* ===========================================================
     画面切り替え
  =========================================================== */
  function showCaseList() {
    state.currentCaseId = null;
    document.getElementById("screen-caselist").hidden = false;
    document.getElementById("screen-workspace").hidden = true;
    document.getElementById("tab-nav").hidden = true;
    document.getElementById("btn-back-list").hidden = true;
    document.getElementById("case-name-display").textContent = "";
    document.getElementById("save-status").textContent = "";
    renderCaseList();
  }

  function openCase(id) {
    state.currentCaseId = id;
    state.currentTab = "basic";
    document.getElementById("screen-caselist").hidden = true;
    document.getElementById("screen-workspace").hidden = false;
    document.getElementById("tab-nav").hidden = false;
    document.getElementById("btn-back-list").hidden = false;
    renderWorkspace();
    switchTab("basic");
  }

  function switchTab(tab) {
    state.currentTab = tab;
    document.querySelectorAll(".tab-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    document.querySelectorAll(".tab-pane").forEach(function (p) {
      p.classList.toggle("active", p.id === "tab-" + tab);
    });
    if (tab === "tree") { renderTree(); }
    if (tab === "summary") { renderPrintArea(); }
  }

  /* ===========================================================
     案件一覧
  =========================================================== */
  function renderCaseList() {
    var wrap = document.getElementById("case-list");
    wrap.innerHTML = "";
    var sorted = state.cases.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    if (sorted.length === 0) {
      wrap.appendChild(el("div", { class: "empty-msg", text: "案件はまだありません。「＋ 新規案件」から作成してください。" }));
      return;
    }
    sorted.forEach(function (c) {
      var title = c.title || c.decedent.name || "（無題の案件）";
      var meta = "更新: " + new Date(c.updatedAt).toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      var card = el("div", { class: "case-card" }, [
        el("div", { class: "case-card-main" }, [
          el("div", { class: "case-card-title", text: title }),
          el("div", { class: "case-card-meta", text: meta })
        ]),
        el("div", { class: "case-card-actions" }, [
          el("button", { class: "btn btn-primary btn-small", text: "開く", onclick: function () { openCase(c.id); } }),
          el("button", { class: "btn btn-secondary btn-small", text: "複製", onclick: function () { duplicateCase(c.id); } }),
          el("button", { class: "btn btn-secondary btn-small", text: "JSON書出", onclick: function () { exportCaseJSON(c); } }),
          el("button", { class: "btn btn-danger btn-small", text: "削除", onclick: function () { deleteCase(c.id); } })
        ])
      ]);
      wrap.appendChild(card);
    });
  }

  function duplicateCase(id) {
    var src = state.cases.find(function (c) { return c.id === id; });
    if (!src) return;
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = uid();
    copy.title = (src.title || src.decedent.name || "無題") + "のコピー";
    copy.createdAt = copy.updatedAt = Date.now();
    // 人物・書類・財産のIDも振り直す
    copy.people.forEach(function (p) { p.id = uid(); });
    copy.assets.forEach(function (a) { a.id = uid(); });
    copy.interview.docs.forEach(function (d) { d.id = uid(); });
    state.cases.push(copy);
    saveCases(state.cases);
    renderCaseList();
  }

  function deleteCase(id) {
    var c = state.cases.find(function (c) { return c.id === id; });
    if (!c) return;
    if (!confirm((c.title || c.decedent.name || "この案件") + " を削除します。よろしいですか？（元に戻せません）")) return;
    state.cases = state.cases.filter(function (c) { return c.id !== id; });
    saveCases(state.cases);
    renderCaseList();
  }

  function exportCaseJSON(c) {
    var blob = new Blob([JSON.stringify(c, null, 2)], { type: "application/json" });
    downloadBlob(blob, ((c.title || c.decedent.name || "案件") + "_" + todayStamp() + ".json"));
  }

  function importCaseJSONFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || !data.decedent) throw new Error("形式不正");
        data.id = uid(); // 重複防止のためIDは振り直す
        data.updatedAt = Date.now();
        state.cases.push(data);
        saveCases(state.cases);
        renderCaseList();
        alert("読み込みました。");
      } catch (e) {
        alert("読み込みに失敗しました。正しいJSONファイルか確認してください。");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function todayStamp() {
    var d = new Date();
    return d.getFullYear() + "" + String(d.getMonth() + 1).padStart(2, "0") + "" + String(d.getDate()).padStart(2, "0");
  }

  /* ===========================================================
     作業画面：描画
  =========================================================== */
  // 旧バージョンで作成された案件データに新項目を補完する
  function ensureCaseDefaults(c) {
    if (!c.contact) c.contact = { name: "", kana: "", address: "", phone: "", contactTime: "", relation: "", livingTogether: "unknown" };
    if (!c.referral) c.referral = { type: "", dmConsent: "", details: {} };
    if (!c.referral.details) c.referral.details = {};
    if (!c.consultationTypes) c.consultationTypes = [];
  }

  function renderWorkspace() {
    var c = getCase();
    if (!c) return showCaseList();
    ensureCaseDefaults(c);
    document.getElementById("case-name-display").textContent = c.title || c.decedent.name || "（無題の案件）";
    renderBasicTab(c);
    renderInterviewTab(c);
    renderTree(c);
    renderAssetsTab(c);
  }

  /* ---------- 基本情報 ---------- */
  function bindField(idOrEl, getVal, setVal) {
    var input = typeof idOrEl === "string" ? document.getElementById(idOrEl) : idOrEl;
    input.value = getVal() || "";
    input.oninput = function () {
      setVal(input.value);
      var c = getCase(); if (c) touch(c);
      persistDebounced();
    };
  }

  function renderBasicTab(c) {
    bindField("f-title", function () { return c.title; }, function (v) { c.title = v; document.getElementById("case-name-display").textContent = v || c.decedent.name || "（無題の案件）"; });
    bindField("f-staff", function () { return c.staff; }, function (v) { c.staff = v; });

    bindField("c-name", function () { return c.contact.name; }, function (v) { c.contact.name = v; });
    bindField("c-kana", function () { return c.contact.kana; }, function (v) { c.contact.kana = v; });
    bindField("c-address", function () { return c.contact.address; }, function (v) { c.contact.address = v; });
    bindField("c-phone", function () { return c.contact.phone; }, function (v) { c.contact.phone = v; });
    bindField("c-contact-time", function () { return c.contact.contactTime; }, function (v) { c.contact.contactTime = v; });
    bindField("c-relation", function () { return c.contact.relation; }, function (v) { c.contact.relation = v; });
    var livingSel = document.getElementById("c-living-together");
    livingSel.value = c.contact.livingTogether || "unknown";
    livingSel.onchange = function () { c.contact.livingTogether = livingSel.value; touch(c); persistDebounced(); };

    bindField("d-name", function () { return c.decedent.name; }, function (v) { c.decedent.name = v; if (!c.title) document.getElementById("case-name-display").textContent = v; });
    bindField("d-kana", function () { return c.decedent.kana; }, function (v) { c.decedent.kana = v; });
    bindField("d-birth", function () { return c.decedent.birth; }, function (v) { c.decedent.birth = v; });
    bindField("d-death", function () { return c.decedent.death; }, function (v) { c.decedent.death = v; updateDeadlineBox(c); });
    bindField("d-address", function () { return c.decedent.address; }, function (v) { c.decedent.address = v; });
    bindField("d-honseki", function () { return c.decedent.honseki; }, function (v) { c.decedent.honseki = v; });
    bindField("d-job", function () { return c.decedent.job; }, function (v) { c.decedent.job = v; });
    bindField("d-note", function () { return c.decedent.note; }, function (v) { c.decedent.note = v; });
    updateDeadlineBox(c);

    renderReferralChoices(c);
    renderConsultationTypeChecks(c);
  }

  function renderReferralChoices(c) {
    var wrap = document.getElementById("referral-choices");
    wrap.innerHTML = "";
    REFERRAL_OPTIONS.forEach(function (opt) {
      var radio = el("input", { type: "radio", name: "referral-type" });
      radio.checked = c.referral.type === opt.value;
      radio.onchange = function () { c.referral.type = opt.value; touch(c); persistDebounced(); };
      var label = el("label", { class: "radio-label" }, [radio, document.createTextNode(opt.label)]);
      var row = el("div", { class: "choice-row" }, [label]);
      if (opt.hasDetail) {
        var detailInput = el("input", { type: "text", class: "choice-detail", placeholder: opt.detailPlaceholder });
        detailInput.value = c.referral.details[opt.value] || "";
        detailInput.oninput = function () { c.referral.details[opt.value] = detailInput.value; touch(c); persistDebounced(); };
        row.appendChild(detailInput);
      }
      wrap.appendChild(row);
    });

    var yes = document.getElementById("dm-consent-yes");
    var no = document.getElementById("dm-consent-no");
    yes.checked = c.referral.dmConsent === "yes";
    no.checked = c.referral.dmConsent === "no";
    yes.onchange = function () { c.referral.dmConsent = "yes"; touch(c); persistDebounced(); };
    no.onchange = function () { c.referral.dmConsent = "no"; touch(c); persistDebounced(); };
  }

  function renderConsultationTypeChecks(c) {
    var wrap = document.getElementById("consultation-type-checks");
    wrap.innerHTML = "";
    CONSULTATION_TYPES.forEach(function (t) {
      var cb = el("input", { type: "checkbox" });
      cb.checked = c.consultationTypes.indexOf(t) >= 0;
      cb.onchange = function () {
        if (cb.checked) {
          if (c.consultationTypes.indexOf(t) < 0) c.consultationTypes.push(t);
        } else {
          c.consultationTypes = c.consultationTypes.filter(function (x) { return x !== t; });
        }
        touch(c); persistDebounced();
      };
      wrap.appendChild(el("label", { class: "check-label" }, [cb, document.createTextNode(t)]));
    });
  }

  function updateDeadlineBox(c) {
    var box = document.getElementById("deadline-box");
    if (!c.decedent.death) { box.hidden = true; return; }
    var d = addMonths(c.decedent.death, 10);
    if (!d) { box.hidden = true; return; }
    box.hidden = false;
    document.getElementById("deadline-date").textContent = d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }

  /* ---------- 面談記録 ---------- */
  function renderInterviewTab(c) {
    var iv = c.interview;
    bindField("i-date", function () { return iv.date; }, function (v) { iv.date = v; });
    bindField("i-place", function () { return iv.place; }, function (v) { iv.place = v; });
    bindField("i-attendee-staff", function () { return iv.attendeeStaff; }, function (v) { iv.attendeeStaff = v; });
    bindField("i-attendee-family", function () { return iv.attendeeFamily; }, function (v) { iv.attendeeFamily = v; });
    bindField("i-memo", function () { return iv.memo; }, function (v) { iv.memo = v; });
    bindField("i-next-date", function () { return iv.nextDate; }, function (v) { iv.nextDate = v; });
    bindField("i-next-memo", function () { return iv.nextMemo; }, function (v) { iv.nextMemo = v; });

    var hwrap = document.getElementById("hearing-items");
    hwrap.innerHTML = "";
    HEARING_ITEMS.forEach(function (h) {
      if (!iv.hearing[h.key]) iv.hearing[h.key] = { value: h.options[0], memo: "" };
      var rec = iv.hearing[h.key];
      var sel = el("select", {});
      h.options.forEach(function (o) { sel.appendChild(el("option", { value: o, text: o })); });
      sel.value = rec.value;
      sel.onchange = function () { rec.value = sel.value; touch(c); persistDebounced(); };
      var memo = el("textarea", { rows: "2", placeholder: "メモ（詳細・所在・金額感 等）" });
      memo.value = rec.memo || "";
      memo.oninput = function () { rec.memo = memo.value; touch(c); persistDebounced(); };
      hwrap.appendChild(el("div", { class: "hearing-item" }, [
        el("div", { class: "hearing-item-q", text: h.q }),
        el("div", { class: "hearing-item-controls" }, [sel]),
        memo
      ]));
    });

    renderDocChecklist(c);
    document.getElementById("btn-add-doc").onclick = function () {
      iv.docs.push({ id: uid(), name: "", status: "未依頼", memo: "" });
      touch(c); persistDebounced();
      renderDocChecklist(c);
    };
  }

  function renderDocChecklist(c) {
    var body = document.getElementById("doc-checklist-body");
    body.innerHTML = "";
    c.interview.docs.forEach(function (doc) {
      var nameInput = el("input", { type: "text", value: doc.name, placeholder: "書類名" });
      nameInput.oninput = function () { doc.name = nameInput.value; touch(c); persistDebounced(); };
      var statusSel = el("select", {});
      DOC_STATUS_OPTIONS.forEach(function (o) { statusSel.appendChild(el("option", { value: o, text: o })); });
      statusSel.value = doc.status;
      statusSel.onchange = function () { doc.status = statusSel.value; touch(c); persistDebounced(); };
      var memoInput = el("input", { type: "text", value: doc.memo, placeholder: "メモ" });
      memoInput.oninput = function () { doc.memo = memoInput.value; touch(c); persistDebounced(); };
      var delBtn = el("button", { class: "row-del", text: "×", title: "削除", onclick: function () {
        c.interview.docs = c.interview.docs.filter(function (d) { return d.id !== doc.id; });
        touch(c); persistDebounced(); renderDocChecklist(c);
      } });
      var tr = el("tr", {}, [
        el("td", {}, [nameInput]),
        el("td", {}, [statusSel]),
        el("td", {}, [memoInput]),
        el("td", {}, [delBtn])
      ]);
      body.appendChild(tr);
    });
  }

  /* ---------- 相関図・相続人 ---------- */
  var editingPersonId = null;

  function renderTree(cArg) {
    var c = cArg || getCase();
    if (!c) return;
    var rowsWrap = document.getElementById("tree-rows");
    rowsWrap.innerHTML = "";

    var byTier = {};
    TIER_ORDER.forEach(function (t) { byTier[t] = []; });
    c.people.forEach(function (p) {
      var def = REL_MAP[p.relationship];
      var tier = def ? def.tier : 0;
      byTier[tier].push(p);
    });

    TIER_ORDER.forEach(function (tier) {
      var isDecedentRow = tier === 0;
      var row = el("div", { class: "tree-row", "data-tier": tier });
      var rowInner = row;
      if (isDecedentRow) {
        rowInner.appendChild(personBox({
          id: "__decedent__", name: c.decedent.name || "（被相続人 未入力）", relationshipLabel: "被相続人",
          status: "alive", isDecedent: true
        }));
      }
      byTier[tier].forEach(function (p) {
        rowInner.appendChild(personBox(p));
      });
      if (byTier[tier].length === 0 && !isDecedentRow) {
        // 空の段は表示しない（祖父母等）
        return;
      }
      var col = el("div", {}, [
        el("div", { class: "tree-row-label", text: TIER_LABELS[tier] }),
        row
      ]);
      if (isDecedentRow) {
        row.appendChild(el("button", { class: "add-person-inline", text: "＋ 追加", onclick: function () { openPersonModal(null); } }));
      }
      rowsWrap.appendChild(col);
    });

    // 常に追加ボタンが1つはどこかに出るようにする（人物が全く無い場合の保険）
    if (c.people.length === 0) {
      // 決定者行に既に追加ボタンがあるのでOK
    }

    requestAnimationFrame(drawTreeConnectors);
    renderHeirPanel(c);
  }

  function personBox(p) {
    var def = REL_MAP[p.relationship];
    var relLabel = p.relationshipLabel || (def ? def.label : "");
    var statusKey = p.status || "alive";
    var box = el("div", { class: "person-box " + (p.isDecedent ? "decedent " : "") + "status-" + statusKey });
    box.appendChild(el("div", { class: "pb-name", text: p.name || "（氏名未入力）" }));
    box.appendChild(el("div", { class: "pb-rel", text: relLabel }));
    if (!p.isDecedent) {
      box.appendChild(el("div", { class: "pb-status tag-" + statusKey, text: STATUS_LABELS[statusKey] }));
    }
    box.dataset.pid = p.id;
    if (!p.isDecedent) box.onclick = function () { openPersonModal(p.id); };
    return box;
  }

  function drawTreeConnectors() {
    var svg = document.getElementById("tree-svg");
    var wrap = document.getElementById("tree-wrap");
    if (!svg || !wrap) return;
    svg.innerHTML = "";
    var wrapRect = wrap.getBoundingClientRect();
    svg.setAttribute("width", wrap.scrollWidth);
    svg.setAttribute("height", wrap.scrollHeight);

    var rowEls = Array.prototype.slice.call(document.querySelectorAll(".tree-row"));
    function centerOf(elem) {
      var r = elem.getBoundingClientRect();
      return { x: r.left - wrapRect.left + wrap.scrollLeft + r.width / 2, top: r.top - wrapRect.top + wrap.scrollTop, bottom: r.bottom - wrapRect.top + wrap.scrollTop };
    }
    function line(x1, y1, x2, y2) {
      var l = document.createElementNS("http://www.w3.org/2000/svg", "line");
      l.setAttribute("x1", x1); l.setAttribute("y1", y1); l.setAttribute("x2", x2); l.setAttribute("y2", y2);
      l.setAttribute("stroke", "#9fb3c8"); l.setAttribute("stroke-width", "2");
      svg.appendChild(l);
    }

    for (var i = 0; i < rowEls.length - 1; i++) {
      var boxesA = Array.prototype.slice.call(rowEls[i].querySelectorAll(".person-box"));
      var boxesB = Array.prototype.slice.call(rowEls[i + 1].querySelectorAll(".person-box"));
      if (boxesA.length === 0 || boxesB.length === 0) continue;
      var centersA = boxesA.map(centerOf);
      var centersB = boxesB.map(centerOf);
      var aX = centersA.reduce(function (s, p) { return s + p.x; }, 0) / centersA.length;
      var aY = Math.max.apply(null, centersA.map(function (p) { return p.bottom; }));
      var bXs = centersB.map(function (p) { return p.x; });
      var bY = centersB[0].top;
      var midY = (aY + bY) / 2;
      var busMinX = Math.min(aX, Math.min.apply(null, bXs));
      var busMaxX = Math.max(aX, Math.max.apply(null, bXs));
      line(aX, aY, aX, midY);
      line(busMinX, midY, busMaxX, midY);
      bXs.forEach(function (bx) { line(bx, midY, bx, bY); });
    }

    // 同世代内（配偶者⇔本人など）の横線
    rowEls.forEach(function (row) {
      var boxes = Array.prototype.slice.call(row.querySelectorAll(".person-box"));
      if (boxes.length < 2) return;
      var centers = boxes.map(centerOf);
      var y = centers[0].top + (centers[0].bottom - centers[0].top) / 2;
      for (var i = 0; i < centers.length - 1; i++) {
        line(centers[i].x, y, centers[i + 1].x, y);
      }
    });
  }
  window.addEventListener("resize", debounce(function () {
    if (state.currentTab === "tree") drawTreeConnectors();
  }, 200));

  function openPersonModal(id) {
    var c = getCase(); if (!c) return;
    editingPersonId = id;
    var modal = document.getElementById("modal-person");
    var sel = document.getElementById("p-relationship");
    sel.innerHTML = "";
    RELATIONSHIP_OPTIONS.forEach(function (r) { sel.appendChild(el("option", { value: r.value, text: r.label })); });

    var p = id ? c.people.find(function (p) { return p.id === id; }) : null;
    document.getElementById("person-modal-title").textContent = p ? "人物を編集" : "人物を追加";
    document.getElementById("p-name").value = p ? p.name : "";
    document.getElementById("p-kana").value = p ? p.kana : "";
    sel.value = p ? p.relationship : "child_natural";
    document.getElementById("p-birth").value = p ? p.birth || "" : "";
    document.getElementById("p-status").value = p ? p.status : "alive";
    document.getElementById("p-contact").value = p ? p.contact || "" : "";
    document.getElementById("p-note").value = p ? p.note || "" : "";
    document.getElementById("btn-delete-person").hidden = !p;
    modal.hidden = false;
  }
  function closePersonModal() { document.getElementById("modal-person").hidden = true; editingPersonId = null; }

  function savePersonModal() {
    var c = getCase(); if (!c) return;
    var name = document.getElementById("p-name").value.trim();
    var data = {
      name: name,
      kana: document.getElementById("p-kana").value.trim(),
      relationship: document.getElementById("p-relationship").value,
      birth: document.getElementById("p-birth").value,
      status: document.getElementById("p-status").value,
      contact: document.getElementById("p-contact").value.trim(),
      note: document.getElementById("p-note").value.trim()
    };
    if (editingPersonId) {
      var p = c.people.find(function (p) { return p.id === editingPersonId; });
      Object.assign(p, data);
    } else {
      data.id = uid();
      c.people.push(data);
    }
    touch(c); persist();
    closePersonModal();
    renderTree(c);
  }
  function deletePersonModal() {
    var c = getCase(); if (!c || !editingPersonId) return;
    if (!confirm("この人物を削除しますか？")) return;
    c.people = c.people.filter(function (p) { return p.id !== editingPersonId; });
    touch(c); persist();
    closePersonModal();
    renderTree(c);
  }

  function renderHeirPanel(c) {
    var result = computeShares(c.people);
    var deductionCount = computeDeductionCount(c.people);
    var deductionAmount = 30000000 + 6000000 * deductionCount;
    var rankLabel = { 0: "該当なし（相続人未確認）", 1: "第1順位（子・代襲相続人）", 2: "第2順位（直系尊属）", 3: "第3順位（兄弟姉妹・代襲相続人）" }[result.rank];

    var summary = document.getElementById("heir-summary");
    summary.innerHTML = "";
    [
      ["相続順位", rankLabel],
      ["法定相続人の数（基礎控除用・目安）", deductionCount + " 人"],
      ["遺産に係る基礎控除額（目安）", formatYen(deductionAmount)]
    ].forEach(function (pair) {
      summary.appendChild(el("div", { class: "stat" }, [
        el("div", { class: "stat-label", text: pair[0] }),
        el("div", { class: "stat-value", text: pair[1] })
      ]));
    });

    var body = document.getElementById("heir-table-body");
    body.innerHTML = "";
    var rows = [];
    if (result.spouse) rows.push(result.spouse);
    rows = rows.concat(result.groupHeirs);
    if (rows.length === 0) {
      body.appendChild(el("tr", {}, [el("td", { colspan: "4", class: "asset-empty", text: "相続関係図に人物を追加すると、ここに法定相続人が表示されます。" })]));
    } else {
      rows.forEach(function (p) {
        var def = REL_MAP[p.relationship];
        var share = result.shares[p.id];
        body.appendChild(el("tr", {}, [
          el("td", { text: p.name || "（未入力）" }),
          el("td", { text: def ? def.label : "" }),
          el("td", { text: STATUS_LABELS[p.status] }),
          el("td", { text: fracToStr(share) })
        ]));
      });
    }

    // 財産目録タブとの連動表示のため保持
    c._computed = { rank: result.rank, deductionCount: deductionCount, deductionAmount: deductionAmount };
    updateAssetTotals(c);
  }

  /* ---------- 財産目録 ---------- */
  var editingAssetId = null;

  function renderAssetsTab(c) {
    var wrap = document.getElementById("asset-groups");
    wrap.innerHTML = "";
    ASSET_CATEGORIES.forEach(function (cat) {
      var items = c.assets.filter(function (a) { return a.category === cat.key; });
      var subtotal = items.reduce(function (s, a) { return s + (Number(a.value) || 0); }, 0);
      var table = el("table", { class: "asset-table" }, [
        el("thead", {}, [el("tr", {}, [
          el("th", { text: "内容" }), el("th", { text: "数量等" }), el("th", { class: "num", text: "概算評価額" })
        ])]),
      ]);
      var tbody = el("tbody", {});
      if (items.length === 0) {
        tbody.appendChild(el("tr", {}, [el("td", { colspan: "3", class: "asset-empty", text: "登録なし" })]));
      } else {
        items.forEach(function (a) {
          var tr = el("tr", { class: "asset-row", onclick: function () { openAssetModal(a.id); } }, [
            el("td", { text: a.description || "（未入力）" }),
            el("td", { text: a.quantity || "" }),
            el("td", { class: "num", text: formatYen(a.value) })
          ]);
          tbody.appendChild(tr);
        });
      }
      table.appendChild(tbody);
      var groupDiv = el("div", { class: "asset-group" }, [
        el("div", { class: "asset-group-title" }, [
          el("span", { text: cat.label + (cat.sign < 0 ? "（控除）" : "") }),
          el("span", { text: formatYen(subtotal) })
        ]),
        table,
        el("button", { class: "asset-add-row", text: "＋ " + cat.label + " を追加", onclick: function () { openAssetModal(null, cat.key); } })
      ]);
      wrap.appendChild(groupDiv);
    });
    updateAssetTotals(c);
  }

  function updateAssetTotals(c) {
    if (!document.getElementById("asset-total-plus")) return;
    var plus = 0, minus = 0;
    c.assets.forEach(function (a) {
      var cat = ASSET_CAT_MAP[a.category];
      var v = Number(a.value) || 0;
      if (!cat) return;
      if (cat.sign > 0) plus += v; else minus += v;
    });
    var net = plus - minus;
    document.getElementById("asset-total-plus").textContent = formatYen(plus);
    document.getElementById("asset-total-minus").textContent = formatYen(minus);
    document.getElementById("asset-total-net").textContent = formatYen(net);

    var deductionCount = c._computed ? c._computed.deductionCount : computeDeductionCount(c.people);
    var deductionAmount = 30000000 + 6000000 * deductionCount;
    document.getElementById("asset-basic-deduction").textContent = formatYen(deductionAmount);
    var flag = document.getElementById("asset-taxable-flag");
    if (c.people.length === 0 && deductionCount === 0) {
      flag.textContent = "相続関係図の入力待ち";
      flag.className = "";
    } else if (net > deductionAmount) {
      flag.textContent = "基礎控除を超える可能性があります";
      flag.className = "flag-over";
    } else {
      flag.textContent = "基礎控除の範囲内の可能性があります";
      flag.className = "flag-under";
    }
  }

  function openAssetModal(id, defaultCategory) {
    var c = getCase(); if (!c) return;
    editingAssetId = id;
    var modal = document.getElementById("modal-asset");
    var sel = document.getElementById("a-category");
    sel.innerHTML = "";
    ASSET_CATEGORIES.forEach(function (cat) { sel.appendChild(el("option", { value: cat.key, text: cat.label })); });

    var a = id ? c.assets.find(function (a) { return a.id === id; }) : null;
    document.getElementById("asset-modal-title").textContent = a ? "財産・債務を編集" : "財産・債務を追加";
    sel.value = a ? a.category : (defaultCategory || "cash");
    document.getElementById("a-description").value = a ? a.description : "";
    document.getElementById("a-quantity").value = a ? a.quantity : "";
    document.getElementById("a-value").value = a ? a.value : "";
    document.getElementById("a-note").value = a ? a.note || "" : "";
    document.getElementById("btn-delete-asset").hidden = !a;
    modal.hidden = false;
  }
  function closeAssetModal() { document.getElementById("modal-asset").hidden = true; editingAssetId = null; }
  function saveAssetModal() {
    var c = getCase(); if (!c) return;
    var data = {
      category: document.getElementById("a-category").value,
      description: document.getElementById("a-description").value.trim(),
      quantity: document.getElementById("a-quantity").value.trim(),
      value: Number(document.getElementById("a-value").value) || 0,
      note: document.getElementById("a-note").value.trim()
    };
    if (editingAssetId) {
      var a = c.assets.find(function (a) { return a.id === editingAssetId; });
      Object.assign(a, data);
    } else {
      data.id = uid();
      c.assets.push(data);
    }
    touch(c); persist();
    closeAssetModal();
    renderAssetsTab(c);
  }
  function deleteAssetModal() {
    var c = getCase(); if (!c || !editingAssetId) return;
    if (!confirm("この項目を削除しますか？")) return;
    c.assets = c.assets.filter(function (a) { return a.id !== editingAssetId; });
    touch(c); persist();
    closeAssetModal();
    renderAssetsTab(c);
  }

  /* ---------- 概要・印刷 ---------- */
  function renderPrintArea() {
    var c = getCase(); if (!c) return;
    ensureCaseDefaults(c);
    var result = computeShares(c.people);
    var deductionCount = computeDeductionCount(c.people);
    var deductionAmount = 30000000 + 6000000 * deductionCount;
    var plus = 0, minus = 0;
    c.assets.forEach(function (a) {
      var cat = ASSET_CAT_MAP[a.category]; var v = Number(a.value) || 0;
      if (!cat) return;
      if (cat.sign > 0) plus += v; else minus += v;
    });
    var net = plus - minus;

    var html = "";
    html += "<h1>相続税申告 初回面談記録シート</h1>";
    html += "<div class='kv-grid'>";
    html += "<div><span class='k'>案件名</span>" + escapeHtml(c.title || "") + "</div>";
    html += "<div><span class='k'>担当者</span>" + escapeHtml(c.staff || "") + "</div>";
    html += "<div><span class='k'>面談日</span>" + escapeHtml(formatDateJ(c.interview.date)) + "</div>";
    html += "<div><span class='k'>面談場所</span>" + escapeHtml(c.interview.place || "") + "</div>";
    html += "</div>";

    html += "<h2>相談者（来所者）情報</h2><div class='kv-grid'>";
    var ct = c.contact;
    html += "<div><span class='k'>氏名</span>" + escapeHtml(ct.name) + "（" + escapeHtml(ct.kana) + "）</div>";
    html += "<div><span class='k'>対象者との続柄</span>" + escapeHtml(ct.relation) + "</div>";
    html += "<div><span class='k'>住所</span>" + escapeHtml(ct.address) + "</div>";
    html += "<div><span class='k'>連絡先</span>" + escapeHtml(ct.phone) + "</div>";
    html += "<div><span class='k'>連絡のつきやすい時間帯</span>" + escapeHtml(ct.contactTime) + "</div>";
    html += "<div><span class='k'>対象者とのご同居</span>" + LIVING_TOGETHER_LABELS[ct.livingTogether || "unknown"] + "</div>";
    html += "</div>";

    html += "<h2>相談経路・相談内容</h2><div class='kv-grid'>";
    var refDef = REFERRAL_MAP[c.referral.type];
    var refLabel = refDef ? refDef.label : "未選択";
    if (refDef && refDef.hasDetail && c.referral.details[refDef.value]) refLabel += "（" + c.referral.details[refDef.value] + "）";
    html += "<div><span class='k'>相談経路</span>" + escapeHtml(refLabel) + "</div>";
    html += "<div><span class='k'>DM送付</span>" + (c.referral.dmConsent === "yes" ? "希望する" : c.referral.dmConsent === "no" ? "希望しない" : "未確認") + "</div>";
    html += "<div style='grid-column:1/-1;'><span class='k'>相談内容</span>" + (c.consultationTypes.length ? escapeHtml(c.consultationTypes.join("、")) : "未選択") + "</div>";
    html += "</div>";

    html += "<h2>対象者情報（被相続人・申告等が必要な方）</h2><div class='kv-grid'>";
    var d = c.decedent;
    html += "<div><span class='k'>氏名</span>" + escapeHtml(d.name) + "（" + escapeHtml(d.kana) + "）</div>";
    html += "<div><span class='k'>生年月日</span>" + escapeHtml(formatDateJ(d.birth)) + "</div>";
    html += "<div><span class='k'>死亡日</span>" + escapeHtml(formatDateJ(d.death)) + "</div>";
    html += "<div><span class='k'>申告期限</span>" + (function () { var dd = addMonths(d.death, 10); return dd ? (dd.getFullYear() + "年" + (dd.getMonth() + 1) + "月" + dd.getDate() + "日") : ""; })() + "</div>";
    html += "<div><span class='k'>住所</span>" + escapeHtml(d.address) + "</div>";
    html += "<div><span class='k'>本籍地</span>" + escapeHtml(d.honseki) + "</div>";
    html += "</div>";

    html += "<h2>法定相続人・法定相続分（目安）</h2>";
    html += "<table><thead><tr><th>氏名</th><th>続柄</th><th>状況</th><th>法定相続分</th></tr></thead><tbody>";
    var rows = [];
    if (result.spouse) rows.push(result.spouse);
    rows = rows.concat(result.groupHeirs);
    if (rows.length === 0) {
      html += "<tr><td colspan='4'>未入力</td></tr>";
    } else {
      rows.forEach(function (p) {
        var def = REL_MAP[p.relationship];
        html += "<tr><td>" + escapeHtml(p.name) + "</td><td>" + (def ? def.label : "") + "</td><td>" + STATUS_LABELS[p.status] + "</td><td>" + fracToStr(result.shares[p.id]) + "</td></tr>";
      });
    }
    html += "</tbody></table>";
    html += "<p style='font-size:11px;color:#666;'>法定相続人の数（基礎控除用・目安）：" + deductionCount + " 人／遺産に係る基礎控除額（目安）：" + formatYen(deductionAmount) + "<br>※ 上記は面談時の目安です。代襲相続・養子の数の制限等の詳細は専門家が個別に確認します。</p>";

    html += "<h2>財産目録（概算）</h2>";
    html += "<table><thead><tr><th>分類</th><th>内容</th><th>数量等</th><th>概算評価額</th></tr></thead><tbody>";
    if (c.assets.length === 0) {
      html += "<tr><td colspan='4'>未入力</td></tr>";
    } else {
      ASSET_CATEGORIES.forEach(function (cat) {
        c.assets.filter(function (a) { return a.category === cat.key; }).forEach(function (a) {
          html += "<tr><td>" + cat.label + "</td><td>" + escapeHtml(a.description) + "</td><td>" + escapeHtml(a.quantity) + "</td><td>" + formatYen(a.value) + "</td></tr>";
        });
      });
    }
    html += "</tbody></table>";
    html += "<div class='kv-grid' style='margin-top:8px;'>";
    html += "<div><span class='k'>積極財産合計</span>" + formatYen(plus) + "</div>";
    html += "<div><span class='k'>債務・葬式費用合計</span>" + formatYen(minus) + "</div>";
    html += "<div><span class='k'>純資産額（概算）</span><strong>" + formatYen(net) + "</strong></div>";
    html += "<div><span class='k'>基礎控除額（目安）</span>" + formatYen(deductionAmount) + "</div>";
    html += "</div>";

    html += "<h2>ヒアリング項目</h2><table><thead><tr><th>項目</th><th>回答</th><th>メモ</th></tr></thead><tbody>";
    HEARING_ITEMS.forEach(function (h) {
      var rec = c.interview.hearing[h.key] || { value: "", memo: "" };
      html += "<tr><td>" + h.q + "</td><td>" + escapeHtml(rec.value) + "</td><td>" + escapeHtml(rec.memo) + "</td></tr>";
    });
    html += "</tbody></table>";

    html += "<h2>必要書類チェックリスト</h2><table><thead><tr><th>書類名</th><th>状況</th><th>メモ</th></tr></thead><tbody>";
    c.interview.docs.forEach(function (doc) {
      html += "<tr><td>" + escapeHtml(doc.name) + "</td><td>" + escapeHtml(doc.status) + "</td><td>" + escapeHtml(doc.memo) + "</td></tr>";
    });
    html += "</tbody></table>";

    html += "<h2>面談メモ・特記事項</h2><div class='memo-block'>" + escapeHtml(c.interview.memo || "（記載なし）") + "</div>";
    html += "<div class='kv-grid' style='margin-top:8px;'><div><span class='k'>次回打合せ予定</span>" + escapeHtml(formatDateJ(c.interview.nextDate)) + "</div><div><span class='k'>次回打合せ内容</span>" + escapeHtml(c.interview.nextMemo || "") + "</div></div>";

    document.getElementById("print-area").innerHTML = html;
  }

  /* ---------- Excel(.xls / SpreadsheetML) 出力 ---------- */
  function xmlEscape(s) {
    return (s == null ? "" : String(s)).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c];
    });
  }
  function xlsCell(v) {
    if (typeof v === "number") return "<Cell><Data ss:Type=\"Number\">" + v + "</Data></Cell>";
    return "<Cell><Data ss:Type=\"String\">" + xmlEscape(v) + "</Data></Cell>";
  }
  function buildXlsXml(sheets) {
    var xml = '<?xml version="1.0"?>\n';
    xml += '<?mso-application progid="Excel.Sheet"?>\n';
    xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';
    xml += '<Styles><Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#DCE6F1" ss:Pattern="Solid"/></Style></Styles>\n';
    sheets.forEach(function (sheet) {
      xml += '<Worksheet ss:Name="' + xmlEscape(sheet.name) + '"><Table>\n';
      sheet.rows.forEach(function (row, idx) {
        xml += "<Row>";
        row.forEach(function (cellVal) { xml += xlsCell(cellVal); });
        xml += "</Row>\n";
      });
      xml += "</Table></Worksheet>\n";
    });
    xml += "</Workbook>";
    return xml;
  }
  function exportAssetsXLS() {
    var c = getCase(); if (!c) return;
    var rows = [["分類", "内容", "数量等", "概算評価額（円）", "備考"]];
    ASSET_CATEGORIES.forEach(function (cat) {
      c.assets.filter(function (a) { return a.category === cat.key; }).forEach(function (a) {
        rows.push([cat.label, a.description || "", a.quantity || "", Number(a.value) || 0, a.note || ""]);
      });
    });
    var plus = 0, minus = 0;
    c.assets.forEach(function (a) { var cat = ASSET_CAT_MAP[a.category]; var v = Number(a.value) || 0; if (cat && cat.sign > 0) plus += v; else minus += v; });
    rows.push(["", "", "", "", ""]);
    rows.push(["積極財産合計", "", "", plus, ""]);
    rows.push(["債務・葬式費用合計", "", "", minus, ""]);
    rows.push(["純資産額（概算）", "", "", plus - minus, ""]);
    var xml = buildXlsXml([{ name: "財産目録", rows: rows }]);
    var blob = new Blob([xml], { type: "application/vnd.ms-excel" });
    downloadBlob(blob, (c.title || c.decedent.name || "財産目録") + "_財産目録_" + todayStamp() + ".xls");
  }
  function exportHeirsXLS() {
    var c = getCase(); if (!c) return;
    var result = computeShares(c.people);
    var rows = [["氏名", "フリガナ", "続柄", "状況", "法定相続分"]];
    var list = [];
    if (result.spouse) list.push(result.spouse);
    list = list.concat(result.groupHeirs);
    list.forEach(function (p) {
      var def = REL_MAP[p.relationship];
      rows.push([p.name || "", p.kana || "", def ? def.label : "", STATUS_LABELS[p.status], fracToStr(result.shares[p.id])]);
    });
    var deductionCount = computeDeductionCount(c.people);
    rows.push(["", "", "", "", ""]);
    rows.push(["法定相続人の数（基礎控除用・目安）", deductionCount, "", "", ""]);
    rows.push(["遺産に係る基礎控除額（目安）", 30000000 + 6000000 * deductionCount, "", "", ""]);
    var xml = buildXlsXml([{ name: "相続人一覧", rows: rows }]);
    var blob = new Blob([xml], { type: "application/vnd.ms-excel" });
    downloadBlob(blob, (c.title || c.decedent.name || "相続人一覧") + "_相続人一覧_" + todayStamp() + ".xls");
  }

  /* ===========================================================
     初期化・イベント配線
  =========================================================== */
  function init() {
    document.getElementById("btn-new-case").onclick = function () {
      var c = newCaseSkeleton();
      state.cases.push(c);
      saveCases(state.cases);
      openCase(c.id);
    };
    document.getElementById("input-import-json").onchange = function (e) {
      if (e.target.files && e.target.files[0]) importCaseJSONFile(e.target.files[0]);
      e.target.value = "";
    };
    document.getElementById("btn-back-list").onclick = function () { persist(); showCaseList(); };

    document.querySelectorAll(".tab-btn").forEach(function (b) {
      b.onclick = function () { switchTab(b.dataset.tab); };
    });

    document.getElementById("btn-add-person").onclick = function () { openPersonModal(null); };
    document.getElementById("btn-cancel-person").onclick = closePersonModal;
    document.getElementById("btn-save-person").onclick = savePersonModal;
    document.getElementById("btn-delete-person").onclick = deletePersonModal;

    document.getElementById("btn-add-asset").onclick = function () { openAssetModal(null); };
    document.getElementById("btn-cancel-asset").onclick = closeAssetModal;
    document.getElementById("btn-save-asset").onclick = saveAssetModal;
    document.getElementById("btn-delete-asset").onclick = deleteAssetModal;

    document.getElementById("btn-print").onclick = function () { renderPrintArea(); window.print(); };
    document.getElementById("btn-export-json").onclick = function () { var c = getCase(); if (c) exportCaseJSON(c); };
    document.getElementById("btn-export-assets-xls").onclick = exportAssetsXLS;
    document.getElementById("btn-export-heirs-xls").onclick = exportHeirsXLS;

    // モーダル背景タップで閉じる
    document.getElementById("modal-person").addEventListener("click", function (e) { if (e.target === this) closePersonModal(); });
    document.getElementById("modal-asset").addEventListener("click", function (e) { if (e.target === this) closeAssetModal(); });

    showCaseList();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
