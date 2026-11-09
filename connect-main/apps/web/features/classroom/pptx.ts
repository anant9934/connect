// Builds an editable PowerPoint (.pptx) from a live deck, in the browser, with no server work.
// The package is the minimal OpenXML set PowerPoint, Keynote, Google Slides and LibreOffice
// open: content types, presentation, one master, one blank layout, a theme, and one slide each.
import JSZip from 'jszip';
import type { LiveDeck, LiveSlide } from './liveCanvas';
import { layoutDiagram } from './diagramLayout';

const EMU = 914400; // per inch
const SLIDE_W = 12192000; // 13.333 in
const SLIDE_H = 6858000; // 7.5 in
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const INK = '17171A', MUTED = '5F5F68', VIOLET = '7444E8', VIOLET_TINT = 'F1EBFF', MARIGOLD = 'FFC93C', MARIGOLD_TINT = 'FFF4D1', MINT_TINT = 'E4F8EB', MINT = '2DBE74';

export const xmlEscape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
    // Characters XML 1.0 forbids would make the file unopenable.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

interface Run { text: string; size: number; bold?: boolean; color?: string; font?: string; bullet?: boolean }

let shapeId = 2;
const nextId = () => shapeId++;

function paragraphs(runs: Run[], align: 'l' | 'ctr' = 'l') {
  return runs.map((r) => {
    const font = r.font ? `<a:latin typeface="${r.font}"/><a:cs typeface="${r.font}"/>` : '';
    const bullet = r.bullet ? `<a:pPr marL="342900" indent="-342900" algn="${align}"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>` : `<a:pPr algn="${align}"><a:buNone/></a:pPr>`;
    return `<a:p>${bullet}<a:r><a:rPr lang="en-US" sz="${Math.round(r.size * 100)}" b="${r.bold ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${r.color ?? INK}"/></a:solidFill>${font}</a:rPr><a:t>${xmlEscape(r.text)}</a:t></a:r></a:p>`;
  }).join('');
}

function textBox(x: number, y: number, w: number, h: number, runs: Run[], opts: { fill?: string; line?: string; geom?: string; align?: 'l' | 'ctr'; anchor?: 't' | 'ctr' } = {}) {
  const id = nextId();
  const fill = opts.fill ? `<a:solidFill><a:srgbClr val="${opts.fill}"/></a:solidFill>` : '<a:noFill/>';
  const line = opts.line ? `<a:ln w="19050"><a:solidFill><a:srgbClr val="${opts.line}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm><a:prstGeom prst="${opts.geom ?? 'rect'}"><a:avLst/></a:prstGeom>${fill}${line}</p:spPr>`
    + `<p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="${opts.anchor ?? 't'}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs(runs.length ? runs : [{ text: '', size: 12 }], opts.align)}</p:txBody></p:sp>`;
}

function connector(x1: number, y1: number, x2: number, y2: number, color: string) {
  const id = nextId();
  const flipH = x2 < x1 ? ' flipH="1"' : '';
  const flipV = y2 < y1 ? ' flipV="1"' : '';
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Connector ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>`
    + `<p:spPr><a:xfrm${flipH}${flipV}><a:off x="${Math.round(Math.min(x1, x2))}" y="${Math.round(Math.min(y1, y2))}"/><a:ext cx="${Math.round(Math.abs(x2 - x1))}" cy="${Math.round(Math.abs(y2 - y1))}"/></a:xfrm>`
    + `<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="19050"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>`;
}

function table(x: number, y: number, w: number, headers: string[], rows: string[][]) {
  const id = nextId();
  const cols = Math.max(headers.length, ...rows.map((r) => r.length), 1);
  const colW = Math.floor(w / cols);
  const rowH = 420000;
  const cell = (text: string, header: boolean) =>
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${paragraphs([{ text, size: 14, bold: header, color: header ? '3F1F9E' : INK }])}</a:txBody><a:tcPr>${header ? `<a:solidFill><a:srgbClr val="${VIOLET_TINT}"/></a:solidFill>` : ''}</a:tcPr></a:tc>`;
  const tr = (cells: string[], header: boolean) => `<a:tr h="${rowH}">${Array.from({ length: cols }, (_, i) => cell(cells[i] ?? '', header)).join('')}</a:tr>`;
  const body = [...(headers.length ? [tr(headers, true)] : []), ...rows.map((r) => tr(r, false))].join('');
  const h = rowH * ((headers.length ? 1 : 0) + rows.length);
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>`
    + `<p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${colW * cols}" cy="${h}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">`
    + `<a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${Array.from({ length: cols }, () => `<a:gridCol w="${colW}"/>`).join('')}</a:tblGrid>${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

const GEOM = { rect: 'roundRect', diamond: 'diamond', pill: 'flowChartTerminator', cylinder: 'can' } as const;
const FILL = { rect: [VIOLET_TINT, VIOLET, '3F1F9E'], diamond: [MARIGOLD_TINT, 'E0A800', '6B4E00'], pill: [VIOLET, '5A2FC7', 'FFFFFF'], cylinder: [MINT_TINT, MINT, '1F6B3B'] } as const;

function slideBody(slide: LiveSlide): string {
  const left = 0.6 * EMU, top = 1.5 * EMU, width = SLIDE_W - 1.2 * EMU, height = SLIDE_H - 2.1 * EMU;
  const bullets = (items: string[] | undefined, x = left, y = top, w = width, h = height) =>
    items?.length ? textBox(x, y, w, h, items.map((t) => ({ text: t, size: 20, bullet: true }))) : '';
  switch (slide.layout) {
    case 'title':
      return textBox(left, 2.2 * EMU, width, 1.6 * EMU, [{ text: slide.title, size: 44, bold: true }])
        + (slide.subtitle ? textBox(left, 3.9 * EMU, width, 1 * EMU, [{ text: slide.subtitle, size: 24, color: MUTED }]) : '');
    case 'table':
      return slide.table ? table(left, top, width, slide.table.headers, slide.table.rows) : '';
    case 'code':
      return textBox(left, top, width, height * 0.72, (slide.code?.source ?? '').split('\n').map((l) => ({ text: l || ' ', size: 14, color: 'F8F8F5', font: 'Courier New' })), { fill: INK })
        + bullets(slide.bullets, left, top + height * 0.76, width, height * 0.24);
    case 'steps':
      return textBox(left, top, width, height, (slide.steps ?? []).map((t, i) => ({ text: `${i + 1}.  ${t}`, size: 20 })));
    case 'comparison': {
      const half = (width - 0.3 * EMU) / 2;
      const column = (c: { heading: string; bullets: string[] } | undefined, x: number, fill: string, ink: string) =>
        c ? textBox(x, top, half, height, [{ text: c.heading, size: 22, bold: true, color: ink }, ...c.bullets.map((b) => ({ text: b, size: 18, bullet: true }))], { fill }) : '';
      return column(slide.left, left, VIOLET_TINT, '3F1F9E') + column(slide.right, left + half + 0.3 * EMU, MARIGOLD_TINT, '6B4E00');
    }
    case 'diagram': {
      if (!slide.diagram) return bullets(slide.bullets);
      const layout = layoutDiagram(slide.diagram);
      const scale = Math.min(width / (layout.width + 60), height / layout.height);
      const ox = left + (width - (layout.width + 60) * scale) / 2;
      const X = (v: number) => ox + v * scale, Y = (v: number) => top + v * scale;
      const lines = layout.edges.map((e) => {
        const a = layout.nodes.find((n) => n.id === e.from)!, b = layout.nodes.find((n) => n.id === e.to)!;
        const [x1, y1, x2, y2] = e.back ? [a.x + a.w, a.y + a.h / 2, b.x + b.w, b.y + b.h / 2] : [a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y];
        const label = e.label ? textBox(X((x1 + x2) / 2) - 0.5 * EMU, Y((y1 + y2) / 2) - 0.15 * EMU, 1 * EMU, 0.3 * EMU, [{ text: e.label, size: 11 }], { fill: 'FFFFFF', align: 'ctr', anchor: 'ctr' }) : '';
        return connector(X(x1), Y(y1), X(x2), Y(y2), e.back ? 'B8860B' : MUTED) + label;
      }).join('');
      const nodes = layout.nodes.map((n) => {
        const [fill, line, ink] = FILL[n.shape];
        return textBox(X(n.x), Y(n.y), n.w * scale, n.h * scale, [{ text: n.label, size: 14, bold: true, color: ink }], { fill, line, geom: GEOM[n.shape], align: 'ctr', anchor: 'ctr' });
      }).join('');
      return lines + nodes;
    }
    default:
      return bullets(slide.bullets);
  }
}

function slideXml(slide: LiveSlide): string {
  shapeId = 2;
  const title = slide.layout === 'title' ? '' : textBox(0.6 * EMU, 0.45 * EMU, SLIDE_W - 1.2 * EMU, 0.9 * EMU, [{ text: slide.title, size: 32, bold: true }]);
  const accent = `<p:sp><p:nvSpPr><p:cNvPr id="1000" name="Accent"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${SLIDE_W}" cy="91440"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${MARIGOLD}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FCFCFA"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${accent}${title}${slideBody(slide)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (items: [string, string, string][]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELS_NS}">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('')}</Relationships>`;

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Tathastu"><a:themeElements><a:clrScheme name="Tathastu"><a:dk1><a:srgbClr val="${INK}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="3F1F9E"/></a:dk2><a:lt2><a:srgbClr val="FCFCFA"/></a:lt2><a:accent1><a:srgbClr val="${VIOLET}"/></a:accent1><a:accent2><a:srgbClr val="${MARIGOLD}"/></a:accent2><a:accent3><a:srgbClr val="${MINT}"/></a:accent3><a:accent4><a:srgbClr val="FF6B6B"/></a:accent4><a:accent5><a:srgbClr val="5A2FC7"/></a:accent5><a:accent6><a:srgbClr val="B8860B"/></a:accent6><a:hlink><a:srgbClr val="${VIOLET}"/></a:hlink><a:folHlink><a:srgbClr val="5A2FC7"/></a:folHlink></a:clrScheme><a:fontScheme name="Tathastu"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Tathastu"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="28575"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const EMPTY_TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>';

/** The .pptx file for a deck. */
export async function buildPptx(deck: LiveDeck): Promise<Blob> {
  const zip = new JSZip();
  const n = deck.slides.length;
  const slideOverrides = deck.slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideOverrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  zip.file('_rels/.rels', rels([
    ['rId1', `${REL}/officeDocument`, 'ppt/presentation.xml'],
    ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
    ['rId3', `${REL}/extended-properties`, 'docProps/app.xml'],
  ]));
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(deck.title)}</dc:title><dc:creator>Tathastu Meet</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Tathastu Meet</Application><Slides>${n}</Slides></Properties>`);
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${deck.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', rels([
    ['rId1', `${REL}/slideMaster`, 'slideMasters/slideMaster1.xml'],
    ...deck.slides.map((_, i) => [`rId${i + 2}`, `${REL}/slide`, `slides/slide${i + 1}.xml`] as [string, string, string]),
    [`rId${n + 2}`, `${REL}/theme`, 'theme/theme1.xml'],
  ]));
  zip.file('ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${NS}><p:cSld>${EMPTY_TREE}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([
    ['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml'],
    ['rId2', `${REL}/theme`, '../theme/theme1.xml'],
  ]));
  zip.file('ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', `${REL}/slideMaster`, '../slideMasters/slideMaster1.xml']]));
  zip.file('ppt/theme/theme1.xml', THEME);
  deck.slides.forEach((slide, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, slideXml(slide));
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml']]));
  });
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE' });
}

/** Saves the deck as Title.pptx. */
export async function downloadPptx(deck: LiveDeck) {
  const blob = await buildPptx(deck);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(deck.title || 'Class deck').replace(/[^\w\- ]+/g, '').trim().slice(0, 80) || 'Class deck'}.pptx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
