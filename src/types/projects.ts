import type {
  ArtStyle,
  AssetType,
  ForgeOutput,
  ProspectingOutput,
  SmeltingOutput,
} from "./pipeline";

export type ProjectStage = "ideation" | "prospecting" | "smelting" | "forge" | "complete";

export type ProjectImageSource =
  | "generated"
  | "imported"
  | "web"
  | "anvil"
  | "export"
  | "smelting";

export type ProjectActivityKind =
  | "project_created"
  | "note_saved"
  | "reference_added"
  | "link_saved"
  | "prompt_saved"
  | "board_saved"
  | "generation_saved"
  | "export_saved";

export type AnvilLayerType = "raster" | "shape" | "text" | "reference" | "notes";

export type AnvilTool =
  | "brush"
  | "eraser"
  | "fill"
  | "line"
  | "rectangle"
  | "ellipse"
  | "arrow"
  | "text"
  | "select"
  | "move"
  | "eyedropper";

export interface ProjectNote {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectLink {
  id: string;
  title: string;
  url: string;
  note: string;
  pinned: boolean;
  createdAt: string;
}

export interface ProjectImageRef {
  id: string;
  title: string;
  path: string;
  previewPath: string | null;
  source: ProjectImageSource;
  createdAt: string;
  tags: string[];
  note: string;
}

export interface ProjectPrompt {
  id: string;
  title: string;
  prompt: string;
  negPrompt: string;
  assetType: AssetType | null;
  artStyle: ArtStyle | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectActivity {
  id: string;
  kind: ProjectActivityKind;
  label: string;
  createdAt: string;
  relatedId: string | null;
}

export interface ProjectGenerationRecord {
  id: string;
  stage: "prospecting" | "smelting" | "forge";
  title: string;
  previewPath: string | null;
  createdAt: string;
  kept: boolean;
  prospecting: ProspectingOutput | null;
  smelting: SmeltingOutput | null;
  forge: ForgeOutput | null;
}

export interface ProjectExportRecord {
  id: string;
  title: string;
  format: string;
  path: string;
  previewPath: string | null;
  createdAt: string;
}

export interface AnvilPaletteColor {
  id: string;
  hex: string;
  label: string;
}

export interface AnvilLayerRecord {
  id: string;
  name: string;
  type: AnvilLayerType;
  visible: boolean;
  locked: boolean;
  opacity: number;
}

export interface AnvilBoardGuideState {
  grid: boolean;
  symmetry: boolean;
  perspective: "none" | "one_point" | "two_point" | "isometric";
}

export interface AnvilBoardDocument {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  previewPath: string | null;
  exportPath: string | null;
  activeTool: AnvilTool;
  activeLayerId: string | null;
  palette: AnvilPaletteColor[];
  layers: AnvilLayerRecord[];
  guides: AnvilBoardGuideState;
  sourceImagePath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InterForgeProject {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  stage: ProjectStage;
  folder: string;
  coverImage: string | null;
  tags: string[];
  notes: ProjectNote[];
  links: ProjectLink[];
  references: ProjectImageRef[];
  prompts: ProjectPrompt[];
  anvilBoards: AnvilBoardDocument[];
  generations: ProjectGenerationRecord[];
  exports: ProjectExportRecord[];
  activity: ProjectActivity[];
  prospecting: ProspectingOutput | null;
  smelting: SmeltingOutput | null;
  forge: ForgeOutput | null;
}
