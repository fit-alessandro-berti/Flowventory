export interface GraphNode {
  id: string;
  label: string;
  objectType: string;
  color: string;
  /** Set to true to render this node as a hexagon */
  isHexagon?: boolean;
  isStart?: boolean;
  isEnd?: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  objectType: string;
  color: string;
  count: number;
  averageTime?: number; // in milliseconds
  times?: number[]; // to track individual times for averaging
  /** List of object realizations for this edge and their performance times */
  realizations?: { objectId: string; time: number }[];
}

export interface DirectlyFollowsRelation {
  sourceActivity: string;
  targetActivity: string;
  objectType: string;
  objectId: string;
  count: number;
}