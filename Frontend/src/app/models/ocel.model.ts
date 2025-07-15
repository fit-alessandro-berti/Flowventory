export interface OCELAttribute {
  name: string;
  value: string | number | boolean;
}

export interface OCELTimeAttribute extends OCELAttribute {
  time: string;
}

export interface OCELRelationship {
  objectId: string;
  qualifier: string;
}

export interface OCELEvent {
  id: string;
  type: string;
  time: string;
  attributes: OCELAttribute[];
  relationships: OCELRelationship[];
}

export interface OCELObject {
  id: string;
  type: string;
  attributes?: OCELTimeAttribute[];
  relationships?: OCELRelationship[];
}

export interface OCELTypeAttribute {
  name: string;
  type: 'string' | 'time' | 'integer' | 'float' | 'boolean';
}

export interface OCELObjectType {
  name: string;
  attributes: OCELTypeAttribute[];
}

export interface OCELEventType {
  name: string;
  attributes: OCELTypeAttribute[];
}

export interface OCELData {
  objectTypes: OCELObjectType[];
  eventTypes: OCELEventType[];
  objects: OCELObject[];
  events: OCELEvent[];
}