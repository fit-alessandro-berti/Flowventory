export type VariableType = 'observed' | 'latent';
export type NodeCategory = 'activity' | 'object-metric' | 'performance' | 'complexity';

export interface CausalVariable {
  id: string;
  name: string;
  type: VariableType;
  category: NodeCategory;
  value?: number; // For observed variables
  mean?: number;
  stdDev?: number;
  indicators?: string[]; // For latent variables
}

export interface CausalPath {
  id: string;
  source: string;
  target: string;
  coefficient: number; // Path coefficient (standardized beta)
  stdError?: number;
  pValue?: number;
  isSignificant?: boolean;
}

export interface CausalModel {
  variables: CausalVariable[];
  paths: CausalPath[];
  leadObjectType: string;
  correlationMatrix?: number[][];
  variableNames?: string[];
  modelFit?: {
    chiSquare?: number;
    rmsea?: number;
    cfi?: number;
    srmr?: number;
  };
}