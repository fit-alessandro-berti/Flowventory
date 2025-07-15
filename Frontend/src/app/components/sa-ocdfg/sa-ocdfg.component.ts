import { Component, OnInit, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OcelDataService } from '../../services/ocel-data.service';
import { OCELData, OCELEvent, OCELObject } from '../../models/ocel.model';
import { GraphNode, GraphEdge, DirectlyFollowsRelation } from '../../models/graph.model';
import ELK from 'elkjs/lib/elk.bundled.js';

@Component({
  selector: 'app-sa-ocdfg',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sa-ocdfg.component.html',
  styleUrl: './sa-ocdfg.component.scss'
})
export class SaOcdfgComponent implements OnInit, AfterViewInit {
  @ViewChild('svgContainer', { static: false }) svgContainer!: ElementRef<SVGSVGElement>;
  
  loading = true;
  nodes: GraphNode[] = [];
  edges: GraphEdge[] = [];
  
  private elk = new ELK();
  private colorPalette = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
  ];
  objectTypeColors: { [key: string]: string } = {};
  activeObjectTypes: Set<string> = new Set();
  private ocelData: OCELData | null = null;
  
  decorationOptions = ['Frequency', 'Average Time'];
  selectedDecoration = 'Frequency';

  constructor(private ocelDataService: OcelDataService) {}

  ngOnInit(): void {
    this.ocelDataService.ocelData$.subscribe(data => {
      if (data) {
        this.ocelData = data;
        // Initialize all object types as active
        data.objectTypes.forEach(type => {
          this.activeObjectTypes.add(type.name);
        });
        this.computeDirectlyFollowsGraph(data);
        this.loading = false;
      }
    });
  }

  ngAfterViewInit(): void {
    if (!this.loading) {
      this.renderGraph();
    }
  }

  toggleObjectType(typeName: string): void {
    if (this.activeObjectTypes.has(typeName)) {
      this.activeObjectTypes.delete(typeName);
    } else {
      this.activeObjectTypes.add(typeName);
    }
    
    // Recompute the graph with updated active types
    if (this.ocelData) {
      this.computeDirectlyFollowsGraph(this.ocelData);
    }
  }

  isObjectTypeActive(typeName: string): boolean {
    return this.activeObjectTypes.has(typeName);
  }

  selectDecoration(decoration: string): void {
    this.selectedDecoration = decoration;
    // Rerender the graph with new decoration
    setTimeout(() => this.renderGraph(), 100);
  }

  private computeDirectlyFollowsGraph(data: OCELData): void {
    // Assign colors to object types
    data.objectTypes.forEach((type, index) => {
      this.objectTypeColors[type.name] = this.colorPalette[index % this.colorPalette.length];
    });

    // Group events by object
    const eventsByObject: { [objectId: string]: OCELEvent[] } = {};
    
    data.events.forEach(event => {
      event.relationships.forEach(rel => {
        if (!eventsByObject[rel.objectId]) {
          eventsByObject[rel.objectId] = [];
        }
        eventsByObject[rel.objectId].push(event);
      });
    });

    // Compute directly-follows relations for each object
    const dfRelations: DirectlyFollowsRelation[] = [];
    const nodeSet = new Set<string>();
    const edgeMap = new Map<string, GraphEdge>();

    Object.entries(eventsByObject).forEach(([objectId, events]) => {
      const object = data.objects.find(obj => obj.id === objectId);
      if (!object || !this.activeObjectTypes.has(object.type)) return;

      // Sort events by timestamp
      events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      // Add start node
      const startNodeId = `start_${object.type}`;
      nodeSet.add(startNodeId);

      // Add directly-follows relations
      for (let i = 0; i < events.length; i++) {
        const currentEvent = events[i];
        nodeSet.add(currentEvent.type);

        if (i === 0) {
          // Connect start to first activity
          const edgeKey = `${startNodeId}->${currentEvent.type}_${object.type}`;
          if (!edgeMap.has(edgeKey)) {
            edgeMap.set(edgeKey, {
              id: edgeKey,
              source: startNodeId,
              target: currentEvent.type,
              objectType: object.type,
              color: this.objectTypeColors[object.type],
              count: 1,
              times: []
            });
          } else {
            edgeMap.get(edgeKey)!.count++;
          }
        }

        if (i < events.length - 1) {
          const nextEvent = events[i + 1];
          const edgeKey = `${currentEvent.type}->${nextEvent.type}_${object.type}`;
          const timeDiff = new Date(nextEvent.time).getTime() - new Date(currentEvent.time).getTime();
          
          if (!edgeMap.has(edgeKey)) {
            edgeMap.set(edgeKey, {
              id: edgeKey,
              source: currentEvent.type,
              target: nextEvent.type,
              objectType: object.type,
              color: this.objectTypeColors[object.type],
              count: 1,
              times: [timeDiff]
            });
          } else {
            const edge = edgeMap.get(edgeKey)!;
            edge.count++;
            edge.times!.push(timeDiff);
          }
        } else {
          // Connect last activity to end
          const endNodeId = `end_${object.type}`;
          nodeSet.add(endNodeId);
          const edgeKey = `${currentEvent.type}->${endNodeId}_${object.type}`;
          if (!edgeMap.has(edgeKey)) {
            edgeMap.set(edgeKey, {
              id: edgeKey,
              source: currentEvent.type,
              target: endNodeId,
              objectType: object.type,
              color: this.objectTypeColors[object.type],
              count: 1,
              times: []
            });
          } else {
            edgeMap.get(edgeKey)!.count++;
          }
        }
      }
    });

    // Create nodes
    this.nodes = Array.from(nodeSet).map(nodeId => {
      if (nodeId.startsWith('start_')) {
        const objectType = nodeId.substring(6);
        return {
          id: nodeId,
          label: 'START',
          objectType: objectType,
          color: this.objectTypeColors[objectType],
          isStart: true
        };
      } else if (nodeId.startsWith('end_')) {
        const objectType = nodeId.substring(4);
        return {
          id: nodeId,
          label: 'END',
          objectType: objectType,
          color: this.objectTypeColors[objectType],
          isEnd: true
        };
      } else {
        return {
          id: nodeId,
          label: nodeId,
          objectType: 'activity',
          color: '#ffffff'
        };
      }
    });

    // Calculate average times for all edges
    const allEdges = Array.from(edgeMap.values());
    allEdges.forEach(edge => {
      if (edge.times && edge.times.length > 0) {
        const sum = edge.times.reduce((a, b) => a + b, 0);
        edge.averageTime = sum / edge.times.length;
      }
    });
    
    // Get top 100 most frequent edges
    this.edges = allEdges
      .sort((a, b) => b.count - a.count)
      .slice(0, 100);

    // Filter nodes to only include those connected to the selected edges
    const connectedNodes = new Set<string>();
    this.edges.forEach(edge => {
      connectedNodes.add(edge.source);
      connectedNodes.add(edge.target);
    });

    this.nodes = this.nodes.filter(node => connectedNodes.has(node.id));

    // Render graph after computing
    setTimeout(() => this.renderGraph(), 100);
  }

  private wrapText(text: string, maxLength: number = 18): string[] {
    if (text.length <= maxLength) return [text];
    
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    
    for (const word of words) {
      if (currentLine.length + word.length + 1 <= maxLength) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    
    // If no word breaks were found, force break at character limit
    if (lines.length === 1 && lines[0].length > maxLength) {
      const result: string[] = [];
      let str = lines[0];
      while (str.length > 0) {
        result.push(str.substring(0, maxLength));
        str = str.substring(maxLength);
      }
      return result;
    }
    
    return lines;
  }

  private formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  private calculateNodeSize(label: string, isStartEnd: boolean): { width: number; height: number } {
    if (isStartEnd) {
      return { width: 60, height: 60 };
    }
    
    const lines = this.wrapText(label);
    const charWidth = 8; // Approximate character width
    const lineHeight = 20; // Line height
    const padding = 20; // Padding
    
    const maxLineLength = Math.max(...lines.map(line => line.length));
    const width = Math.max(maxLineLength * charWidth + padding, 80);
    const height = lines.length * lineHeight + padding;
    
    return { width, height };
  }

  private async renderGraph(): Promise<void> {
    if (!this.svgContainer || this.nodes.length === 0) return;

    // Prepare ELK graph
    const elkGraph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.layered.spacing.nodeNodeBetweenLayers': '100',
        'elk.spacing.nodeNode': '80',
        'elk.layered.thoroughness': '100'
      },
      children: this.nodes.map(node => {
        const size = this.calculateNodeSize(node.label, node.isStart || node.isEnd || false);
        return {
          id: node.id,
          width: size.width,
          height: size.height,
          labels: [{ text: node.label }]
        };
      }),
      edges: this.edges.map(edge => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target]
      }))
    };

    try {
      const layout = await this.elk.layout(elkGraph);
      this.drawGraph(layout);
    } catch (error) {
      console.error('Error laying out graph:', error);
    }
  }

  private drawGraph(layout: any): void {
    const svg = this.svgContainer.nativeElement;
    svg.innerHTML = '';

    // Set viewBox and dimensions based on layout
    const padding = 50;
    const width = layout.width + 2 * padding;
    const height = layout.height + 2 * padding;
    svg.setAttribute('viewBox', `${-padding} ${-padding} ${width} ${height}`);
    svg.setAttribute('width', width.toString());
    svg.setAttribute('height', height.toString());

    // Draw edges
    const edgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    edgeGroup.setAttribute('class', 'edges');
    
    layout.edges.forEach((edge: any) => {
      const graphEdge = this.edges.find(e => e.id === edge.id);
      if (!graphEdge) return;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const points = edge.sections[0].bendPoints || [];
      const startPoint = edge.sections[0].startPoint;
      const endPoint = edge.sections[0].endPoint;
      
      let d = `M ${startPoint.x} ${startPoint.y}`;
      points.forEach((point: any) => {
        d += ` L ${point.x} ${point.y}`;
      });
      d += ` L ${endPoint.x} ${endPoint.y}`;
      
      path.setAttribute('d', d);
      path.setAttribute('stroke', graphEdge.color);
      path.setAttribute('stroke-width', Math.min(1 + graphEdge.count * 0.5, 5).toString());
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', `url(#arrowhead-${graphEdge.objectType})`);
      
      edgeGroup.appendChild(path);
      
      // Add edge label if not going to/from start/end nodes
      if (!graphEdge.source.startsWith('start_') && !graphEdge.target.startsWith('end_')) {
        const midX = (startPoint.x + endPoint.x) / 2;
        const midY = (startPoint.y + endPoint.y) / 2;
        
        const labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        
        // Create text element first to measure it
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', midX.toString());
        text.setAttribute('y', midY.toString());
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('font-size', '10');
        text.setAttribute('font-weight', 'bold');
        
        let labelText = '';
        if (this.selectedDecoration === 'Frequency') {
          labelText = graphEdge.count.toString();
        } else if (this.selectedDecoration === 'Average Time' && graphEdge.averageTime !== undefined) {
          labelText = this.formatDuration(graphEdge.averageTime);
        }
        
        text.textContent = labelText;
        
        // Create background rect
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const padding = 3;
        const textWidth = labelText.length * 6; // Approximate width
        const textHeight = 12;
        
        rect.setAttribute('x', (midX - textWidth / 2 - padding).toString());
        rect.setAttribute('y', (midY - textHeight / 2 - padding).toString());
        rect.setAttribute('width', (textWidth + 2 * padding).toString());
        rect.setAttribute('height', (textHeight + 2 * padding).toString());
        rect.setAttribute('fill', 'white');
        rect.setAttribute('stroke', graphEdge.color);
        rect.setAttribute('stroke-width', '0.5');
        rect.setAttribute('rx', '2');
        
        labelGroup.appendChild(rect);
        labelGroup.appendChild(text);
        edgeGroup.appendChild(labelGroup);
      }
    });
    
    svg.appendChild(edgeGroup);

    // Draw nodes
    const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    nodeGroup.setAttribute('class', 'nodes');
    
    layout.children.forEach((node: any) => {
      const graphNode = this.nodes.find(n => n.id === node.id);
      if (!graphNode) return;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      
      if (graphNode.isStart || graphNode.isEnd) {
        // Draw circle for start/end nodes
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', (node.x + node.width / 2).toString());
        circle.setAttribute('cy', (node.y + node.height / 2).toString());
        circle.setAttribute('r', '20');
        circle.setAttribute('fill', graphNode.color);
        circle.setAttribute('stroke', '#333');
        circle.setAttribute('stroke-width', '2');
        g.appendChild(circle);
      } else {
        // Draw rectangle for activity nodes
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', node.x.toString());
        rect.setAttribute('y', node.y.toString());
        rect.setAttribute('width', node.width.toString());
        rect.setAttribute('height', node.height.toString());
        rect.setAttribute('fill', graphNode.color);
        rect.setAttribute('stroke', '#333');
        rect.setAttribute('stroke-width', '2');
        rect.setAttribute('rx', '5');
        g.appendChild(rect);
      }

      // Add text with line wrapping
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', (node.x + node.width / 2).toString());
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '12');
      text.setAttribute('fill', graphNode.isStart || graphNode.isEnd ? 'white' : 'black');
      
      if (graphNode.isStart || graphNode.isEnd) {
        // Single line for start/end nodes
        text.setAttribute('y', (node.y + node.height / 2 + 5).toString());
        text.textContent = graphNode.label;
      } else {
        // Multi-line for activity nodes
        const lines = this.wrapText(graphNode.label);
        const lineHeight = 20;
        const startY = node.y + node.height / 2 - (lines.length - 1) * lineHeight / 2;
        
        lines.forEach((line, index) => {
          const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          tspan.setAttribute('x', (node.x + node.width / 2).toString());
          tspan.setAttribute('y', (startY + index * lineHeight).toString());
          tspan.setAttribute('dy', '0.35em');
          tspan.textContent = line;
          text.appendChild(tspan);
        });
      }
      
      g.appendChild(text);
      
      nodeGroup.appendChild(g);
    });
    
    svg.appendChild(nodeGroup);

    // Add arrow markers
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    Object.entries(this.objectTypeColors).forEach(([type, color]) => {
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', `arrowhead-${type}`);
      marker.setAttribute('markerWidth', '10');
      marker.setAttribute('markerHeight', '10');
      marker.setAttribute('refX', '9');
      marker.setAttribute('refY', '3');
      marker.setAttribute('orient', 'auto');
      
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', '0 0, 10 3, 0 6');
      polygon.setAttribute('fill', color);
      
      marker.appendChild(polygon);
      defs.appendChild(marker);
    });
    svg.appendChild(defs);
  }
}
