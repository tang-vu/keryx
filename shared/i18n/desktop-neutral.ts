import { nativeDesktopMessages } from "../../locales/en/native-desktop";
import type { PresentationLanguage } from "./presentation-language";

// Deliberate neutral-label allowlist. Financial, recovery, trust and private-boundary
// copy stays with the English catalogue; this does not activate a UI locale.
const english = Object.freeze({
  "nativeDesktop.workspace.none": nativeDesktopMessages["nativeDesktop.workspace.none"],
  "nativeDesktop.workspace.open": nativeDesktopMessages["nativeDesktop.workspace.open"],
  "nativeDesktop.workspace.new": nativeDesktopMessages["nativeDesktop.workspace.new"],
  "nativeDesktop.workspace.create": nativeDesktopMessages["nativeDesktop.workspace.create"],
  "nativeDesktop.workspace.openExisting": nativeDesktopMessages["nativeDesktop.workspace.openExisting"],
  "nativeDesktop.workspace.refresh": nativeDesktopMessages["nativeDesktop.workspace.refresh"],
  "nativeDesktop.workspace.refreshTasks": nativeDesktopMessages["nativeDesktop.workspace.refreshTasks"],
  "nativeDesktop.task.new": nativeDesktopMessages["nativeDesktop.task.new"],
  "nativeDesktop.task.section": nativeDesktopMessages["nativeDesktop.task.section"],
  "nativeDesktop.breadcrumb.task": nativeDesktopMessages["nativeDesktop.breadcrumb.task"],
  "nativeDesktop.breadcrumb.desk": nativeDesktopMessages["nativeDesktop.breadcrumb.desk"],
  "nativeDesktop.task.title": nativeDesktopMessages["nativeDesktop.task.title"],
  "nativeDesktop.desk.title": nativeDesktopMessages["nativeDesktop.desk.title"],
  "nativeDesktop.task.question": nativeDesktopMessages["nativeDesktop.task.question"],
  "nativeDesktop.task.questionPlaceholder": nativeDesktopMessages["nativeDesktop.task.questionPlaceholder"],
  "nativeDesktop.task.depth": nativeDesktopMessages["nativeDesktop.task.depth"],
  "nativeDesktop.reference.eyebrow": nativeDesktopMessages["nativeDesktop.reference.eyebrow"],
  "nativeDesktop.reference.title": nativeDesktopMessages["nativeDesktop.reference.title"],
  "nativeDesktop.reference.import": nativeDesktopMessages["nativeDesktop.reference.import"],
});

export type DesktopNeutralKey = keyof typeof english;
type Catalogue = Readonly<Record<DesktopNeutralKey, string>>;

export const desktopNeutralCatalogues = Object.freeze({
  en: english,
  vi: Object.freeze({
    "nativeDesktop.workspace.none": "Chưa mở không gian làm việc",
    "nativeDesktop.workspace.open": "Mở không gian làm việc",
    "nativeDesktop.workspace.new": "Không gian làm việc mới",
    "nativeDesktop.workspace.create": "Tạo không gian làm việc ",
    "nativeDesktop.workspace.openExisting": "Mở không gian có sẵn",
    "nativeDesktop.workspace.refresh": "↻ Làm mới",
    "nativeDesktop.workspace.refreshTasks": "Làm mới tác vụ",
    "nativeDesktop.task.new": "＋ Tác vụ nghiên cứu mới",
    "nativeDesktop.task.section": "02 / TÁC VỤ NGHIÊN CỨU ",
    "nativeDesktop.breadcrumb.task": "CHI TIẾT TÁC VỤ",
    "nativeDesktop.breadcrumb.desk": "BÀN NGHIÊN CỨU",
    "nativeDesktop.task.title": "Tác vụ nghiên cứu",
    "nativeDesktop.desk.title": "Bàn nghiên cứu",
    "nativeDesktop.task.question": "Câu hỏi nghiên cứu",
    "nativeDesktop.task.questionPlaceholder": "Bạn muốn tìm hiểu điều gì?",
    "nativeDesktop.task.depth": "ĐỘ SÂU NGHIÊN CỨU",
    "nativeDesktop.reference.eyebrow": "THƯ VIỆN CỤC BỘ",
    "nativeDesktop.reference.title": "Bản chụp tài liệu tham khảo",
    "nativeDesktop.reference.import": "+ Nhập tệp",
  }),
  pt: Object.freeze({
    "nativeDesktop.workspace.none": "Nenhum espaço de trabalho aberto",
    "nativeDesktop.workspace.open": "Abrir espaço de trabalho",
    "nativeDesktop.workspace.new": "Novo espaço de trabalho",
    "nativeDesktop.workspace.create": "Criar espaço de trabalho ",
    "nativeDesktop.workspace.openExisting": "Abrir existente",
    "nativeDesktop.workspace.refresh": "↻ Atualizar",
    "nativeDesktop.workspace.refreshTasks": "Atualizar tarefas",
    "nativeDesktop.task.new": "＋ Nova tarefa de pesquisa",
    "nativeDesktop.task.section": "02 / TAREFAS DE PESQUISA ",
    "nativeDesktop.breadcrumb.task": "DETALHES DA TAREFA",
    "nativeDesktop.breadcrumb.desk": "MESA DE PESQUISA",
    "nativeDesktop.task.title": "Tarefa de pesquisa",
    "nativeDesktop.desk.title": "Mesa de pesquisa",
    "nativeDesktop.task.question": "Pergunta de pesquisa",
    "nativeDesktop.task.questionPlaceholder": "O que você gostaria de investigar?",
    "nativeDesktop.task.depth": "PROFUNDIDADE DA PESQUISA",
    "nativeDesktop.reference.eyebrow": "BIBLIOTECA LOCAL",
    "nativeDesktop.reference.title": "Cópias de referências",
    "nativeDesktop.reference.import": "+ Importar arquivo",
  }),
  es: Object.freeze({
    "nativeDesktop.workspace.none": "Ningún espacio de trabajo abierto",
    "nativeDesktop.workspace.open": "Abrir espacio de trabajo",
    "nativeDesktop.workspace.new": "Nuevo espacio de trabajo",
    "nativeDesktop.workspace.create": "Crear espacio de trabajo ",
    "nativeDesktop.workspace.openExisting": "Abrir existente",
    "nativeDesktop.workspace.refresh": "↻ Actualizar",
    "nativeDesktop.workspace.refreshTasks": "Actualizar tareas",
    "nativeDesktop.task.new": "＋ Nueva tarea de investigación",
    "nativeDesktop.task.section": "02 / TAREAS DE INVESTIGACIÓN ",
    "nativeDesktop.breadcrumb.task": "DETALLES DE LA TAREA",
    "nativeDesktop.breadcrumb.desk": "MESA DE INVESTIGACIÓN",
    "nativeDesktop.task.title": "Tarea de investigación",
    "nativeDesktop.desk.title": "Mesa de investigación",
    "nativeDesktop.task.question": "Pregunta de investigación",
    "nativeDesktop.task.questionPlaceholder": "¿Qué te gustaría investigar?",
    "nativeDesktop.task.depth": "PROFUNDIDAD DE LA INVESTIGACIÓN",
    "nativeDesktop.reference.eyebrow": "BIBLIOTECA LOCAL",
    "nativeDesktop.reference.title": "Copias de referencias",
    "nativeDesktop.reference.import": "+ Importar archivo",
  }),
} satisfies Readonly<Record<PresentationLanguage, Catalogue>>);

export function desktopNeutralMessages(language: PresentationLanguage) {
  const catalogue: Catalogue = desktopNeutralCatalogues[language];
  return function message(key: DesktopNeutralKey): string {
    if (!Object.hasOwn(catalogue, key)) throw new Error("Unknown neutral Desktop message");
    return catalogue[key];
  };
}
