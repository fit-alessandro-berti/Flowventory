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
}

export interface DirectlyFollowsRelation {
  sourceActivity: string;
  targetActivity: string;
  objectType: string;
  objectId: string;
  count: number;
}