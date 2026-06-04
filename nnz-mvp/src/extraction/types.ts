export interface ExtractionField {
  value: string | number | string[] | null;
  confidence: number;
  evidence: string[];
}

export interface ExtractionResult {
  selfPerception?: ExtractionField;
  selfEsteem?: ExtractionField;
  emotionalExpressiveness?: ExtractionField;
  careStyle?: ExtractionField;
  conflictStyle?: ExtractionField;
  humorLevel?: ExtractionField;
  emotionalAwareness?: ExtractionField;
  adversityResponse?: ExtractionField;
  helpSeekingGiving?: ExtractionField;
  helpSeekingSeeking?: ExtractionField;
  petPhrases?: ExtractionField;
}

export const SOUL_FIELD_MAP: Record<string, string> = {
  humorLevel: 'affectModel.humorLevel',
  petPhrases: 'languageModel.petPhrases',
  relationship: 'identityCore.relationship',
};

export interface MergedField {
  key: string;
  fieldPath: string;
  value: unknown;
  confidence: number;
  shouldPropose: boolean;
  evidence: string[];
}
