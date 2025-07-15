export interface GraphNode {
  id: string;
  label: string;
  objectType: string;
  color: string;
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
}

export interface DirectlyFollowsRelation {
  sourceActivity: string;
  targetActivity: string;
  objectType: string;
  objectId: string;
  count: number;
}