// Turns a presented file into pages drawn in the browser, so every participant renders the same
// file locally and only page numbers travel between them.
import JSZip from 'jszip';

export const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export interface Deck {
  pages: number;
  /** Width over height of a page. */
  aspect: (page: number) => Promise<number>;
  render: (page: number, canvas: HTMLCanvasElement, width: number) => Promise<void>;
  /** PowerPoint is drawn from its text and pictures, so its layouts are approximate. */
  approximate: boolean;
}

async function loadPdf(data: ArrayBuffer): Promise<Deck> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  return {
    pages: doc.numPages,
    approximate: false,
    aspect: async (page) => {
      const viewport = (await doc.getPage(page)).getViewport({ scale: 1 });
      return viewport.width / viewport.height;
    },
    render: async (page, canvas, width) => {
      const pdfPage = await doc.getPage(page);
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: width / base.width });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser cannot draw the presentation.');
      await pdfPage.render({ canvasContext: context, viewport }).promise;
    },
  };
}

interface PptxShape {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: { text: string; sizePt: number; bold: boolean }[];
  image?: string;
}

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU_PER_POINT = 12700;
const DEFAULT_SIZE_PT = 18;

const parseXml = (text: string) => new DOMParser().parseFromString(text, 'application/xml');

function readTransform(shape: Element) {
  const off = shape.getElementsByTagNameNS(NS_A, 'off')[0];
  const ext = shape.getElementsByTagNameNS(NS_A, 'ext')[0];
  return {
    x: Number(off?.getAttribute('x') ?? 0),
    y: Number(off?.getAttribute('y') ?? 0),
    w: Number(ext?.getAttribute('cx') ?? 0),
    h: Number(ext?.getAttribute('cy') ?? 0),
  };
}

async function loadPptx(data: ArrayBuffer): Promise<Deck> {
  const zip = await JSZip.loadAsync(data);
  const size = parseXml(await zip.file('ppt/presentation.xml')!.async('text')).getElementsByTagNameNS(NS_P, 'sldSz')[0];
  const slideWidth = Number(size?.getAttribute('cx') ?? 12192000);
  const slideHeight = Number(size?.getAttribute('cy') ?? 6858000);
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (slideNames.length === 0) throw new Error('This presentation has no slides.');

  const cache = new Map<number, PptxShape[]>();
  const readSlide = async (page: number) => {
    const cached = cache.get(page);
    if (cached) return cached;
    const name = slideNames[page - 1];
    const slide = parseXml(await zip.file(name)!.async('text'));
    const relsFile = zip.file(name.replace('slides/', 'slides/_rels/') + '.rels');
    const targets = new Map<string, string>();
    if (relsFile) {
      for (const rel of Array.from(parseXml(await relsFile.async('text')).getElementsByTagName('Relationship'))) {
        targets.set(rel.getAttribute('Id') ?? '', rel.getAttribute('Target') ?? '');
      }
    }
    const shapes: PptxShape[] = [];
    for (const sp of Array.from(slide.getElementsByTagNameNS(NS_P, 'sp'))) {
      const lines = Array.from(sp.getElementsByTagNameNS(NS_A, 'p')).map((paragraph) => {
        const run = paragraph.getElementsByTagNameNS(NS_A, 'rPr')[0];
        const hundredths = Number(run?.getAttribute('sz') ?? 0);
        return {
          text: Array.from(paragraph.getElementsByTagNameNS(NS_A, 't')).map((t) => t.textContent ?? '').join(''),
          sizePt: hundredths > 0 ? hundredths / 100 : DEFAULT_SIZE_PT,
          bold: run?.getAttribute('b') === '1',
        };
      });
      if (lines.some((line) => line.text)) shapes.push({ ...readTransform(sp), lines });
    }
    for (const pic of Array.from(slide.getElementsByTagNameNS(NS_P, 'pic'))) {
      const embed = pic.getElementsByTagNameNS(NS_A, 'blip')[0]?.getAttributeNS(NS_R, 'embed');
      const target = embed ? targets.get(embed) : undefined;
      const file = target ? zip.file('ppt/' + target.replace(/^(\.\.\/|\/ppt\/)/, '')) : null;
      if (file) {
        shapes.push({ ...readTransform(pic), lines: [], image: URL.createObjectURL(await file.async('blob')) });
      }
    }
    cache.set(page, shapes);
    return shapes;
  };

  return {
    pages: slideNames.length,
    approximate: true,
    aspect: async () => slideWidth / slideHeight,
    render: async (page, canvas, width) => {
      const shapes = await readSlide(page);
      const scale = width / slideWidth;
      canvas.width = Math.ceil(width);
      canvas.height = Math.ceil(slideHeight * scale);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser cannot draw the presentation.');
      context.fillStyle = '#FFFFFF';
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (const shape of shapes) {
        const x = shape.x * scale;
        let y = shape.y * scale;
        if (shape.image) {
          const picture = new Image();
          picture.src = shape.image;
          await picture.decode().catch(() => undefined);
          if (picture.complete && picture.naturalWidth > 0) context.drawImage(picture, x, y, shape.w * scale, shape.h * scale);
          continue;
        }
        context.fillStyle = '#1C1C1C';
        context.textBaseline = 'top';
        for (const line of shape.lines) {
          const size = line.sizePt * EMU_PER_POINT * scale;
          context.font = `${line.bold ? 'bold ' : ''}${size}px sans-serif`;
          let current = '';
          for (const word of line.text.split(' ')) {
            const next = current ? `${current} ${word}` : word;
            if (current && context.measureText(next).width > shape.w * scale) {
              context.fillText(current, x, y);
              y += size * 1.2;
              current = word;
            } else {
              current = next;
            }
          }
          context.fillText(current, x, y);
          y += size * 1.2;
        }
      }
    },
  };
}

export function loadDeck(data: ArrayBuffer, contentType: string): Promise<Deck> {
  return contentType === PPTX_TYPE ? loadPptx(data) : loadPdf(data);
}
