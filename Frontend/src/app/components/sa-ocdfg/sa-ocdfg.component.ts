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
  
  private hoveredEdgeId: string | null = null;
  private hoveredNodeId: string | null = null;

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
              times: [0] // 0 seconds for start edges
            });
          } else {
            const edge = edgeMap.get(edgeKey)!;
            edge.count++;
            edge.times!.push(0); // Always 0 for start edges
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
    
    // Create main group for the graph
    const mainGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    mainGroup.setAttribute('class', 'graph-main');

    // Draw edges
    const edgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    edgeGroup.setAttribute('class', 'edges');
    
    layout.edges.forEach((edge: any) => {
      const graphEdge = this.edges.find(e => e.id === edge.id);
      if (!graphEdge) return;

      const edgeElement = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      edgeElement.setAttribute('class', 'edge-group');
      edgeElement.setAttribute('data-edge-id', graphEdge.id);
      edgeElement.setAttribute('data-source', graphEdge.source);
      edgeElement.setAttribute('data-target', graphEdge.target);

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
      path.setAttribute('class', 'edge-path');
      
      // Create invisible wider path for better hover detection
      const hoverPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hoverPath.setAttribute('d', d);
      hoverPath.setAttribute('stroke', 'transparent');
      hoverPath.setAttribute('stroke-width', '20');
      hoverPath.setAttribute('fill', 'none');
      hoverPath.style.cursor = 'pointer';
      
      edgeElement.appendChild(path);
      edgeElement.appendChild(hoverPath);
      
      // Store edge data for hover
      edgeElement.setAttribute('data-midx', ((startPoint.x + endPoint.x) / 2).toString());
      edgeElement.setAttribute('data-midy', ((startPoint.y + endPoint.y) / 2).toString());
      
      // Add hover event listeners with mouse position tracking
      edgeElement.addEventListener('mouseenter', (event: MouseEvent) => this.onEdgeHover(graphEdge.id, event));
      edgeElement.addEventListener('mousemove', (event: MouseEvent) => this.updateLabelPosition(graphEdge.id, event));
      edgeElement.addEventListener('mouseleave', () => this.onEdgeLeave());
      
      edgeGroup.appendChild(edgeElement);
    });
    
    mainGroup.appendChild(edgeGroup);

    // Draw nodes
    const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    nodeGroup.setAttribute('class', 'nodes');
    
    layout.children.forEach((node: any) => {
      const graphNode = this.nodes.find(n => n.id === node.id);
      if (!graphNode) return;

      const nodeElement = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      nodeElement.setAttribute('class', 'node-group');
      nodeElement.setAttribute('data-node-id', graphNode.id);
      nodeElement.style.cursor = 'pointer';
      
      if (graphNode.isStart || graphNode.isEnd) {
        // Draw circle for start/end nodes
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', (node.x + node.width / 2).toString());
        circle.setAttribute('cy', (node.y + node.height / 2).toString());
        circle.setAttribute('r', '20');
        circle.setAttribute('fill', graphNode.color);
        circle.setAttribute('stroke', '#333');
        circle.setAttribute('stroke-width', '2');
        circle.setAttribute('class', 'node-shape');
        nodeElement.appendChild(circle);
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
        rect.setAttribute('class', 'node-shape');
        nodeElement.appendChild(rect);
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
      
      nodeElement.appendChild(text);
      
      // Add hover event listeners
      nodeElement.addEventListener('mouseenter', () => this.onNodeHover(graphNode.id));
      nodeElement.addEventListener('mouseleave', () => this.onNodeLeave());
      
      nodeGroup.appendChild(nodeElement);
    });
    
    mainGroup.appendChild(nodeGroup);
    
    // Create tooltip element
    const tooltip = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    tooltip.setAttribute('id', 'edge-tooltip');
    tooltip.style.display = 'none';
    tooltip.style.pointerEvents = 'none';
    
    const tooltipRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    tooltipRect.setAttribute('fill', 'white');
    tooltipRect.setAttribute('stroke', '#333');
    tooltipRect.setAttribute('stroke-width', '1');
    tooltipRect.setAttribute('rx', '3');
    tooltipRect.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))';
    
    const tooltipText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tooltipText.setAttribute('text-anchor', 'middle');
    tooltipText.setAttribute('dominant-baseline', 'middle');
    tooltipText.setAttribute('font-size', '12');
    tooltipText.setAttribute('font-weight', 'bold');
    tooltipText.setAttribute('fill', '#333');
    
    tooltip.appendChild(tooltipRect);
    tooltip.appendChild(tooltipText);
    mainGroup.appendChild(tooltip);
    
    svg.appendChild(mainGroup);

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

  private onEdgeHover(edgeId: string, event: MouseEvent): void {
    this.hoveredEdgeId = edgeId;
    const svg = this.svgContainer.nativeElement;
    const edge = this.edges.find(e => e.id === edgeId);
    if (!edge) return;

    // Add blur to all elements
    svg.querySelectorAll('.node-group, .edge-group').forEach(el => {
      el.classList.add('blurred');
    });

    // Remove blur from hovered edge and connected nodes
    const hoveredEdge = svg.querySelector(`[data-edge-id="${edgeId}"]`);
    if (hoveredEdge) {
      hoveredEdge.classList.remove('blurred');
      hoveredEdge.classList.add('highlighted');
    }

    // Highlight connected nodes
    svg.querySelector(`[data-node-id="${edge.source}"]`)?.classList.remove('blurred');
    svg.querySelector(`[data-node-id="${edge.target}"]`)?.classList.remove('blurred');
    
    // Show tooltip if not end edge (allow start edges)
    if (!edge.target.startsWith('end_')) {
      this.showTooltip(edge, event);
    }
  }
  
  private updateLabelPosition(edgeId: string, event: MouseEvent): void {
    const edge = this.edges.find(e => e.id === edgeId);
    if (!edge || edge.target.startsWith('end_')) return;
    this.showTooltip(edge, event);
  }
  
  private showTooltip(edge: GraphEdge, event: MouseEvent): void {
    const svg = this.svgContainer.nativeElement;
    const tooltip = svg.querySelector('#edge-tooltip') as SVGGElement;
    if (!tooltip) return;
    
    const tooltipText = tooltip.querySelector('text') as SVGTextElement;
    const tooltipRect = tooltip.querySelector('rect') as SVGRectElement;
    
    // Set text based on selected decoration
    let labelText = '';
    if (this.selectedDecoration === 'Frequency') {
      labelText = edge.count.toString();
    } else if (this.selectedDecoration === 'Average Time' && edge.averageTime !== undefined) {
      labelText = this.formatDuration(edge.averageTime);
    }
    
    tooltipText.textContent = labelText;
    
    // Get SVG coordinates from mouse position
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    
    // Position tooltip
    const padding = 5;
    const textWidth = labelText.length * 8;
    const textHeight = 20;
    
    tooltipText.setAttribute('x', svgP.x.toString());
    tooltipText.setAttribute('y', (svgP.y - 15).toString());
    
    tooltipRect.setAttribute('x', (svgP.x - textWidth / 2 - padding).toString());
    tooltipRect.setAttribute('y', (svgP.y - 15 - textHeight / 2 - padding).toString());
    tooltipRect.setAttribute('width', (textWidth + 2 * padding).toString());
    tooltipRect.setAttribute('height', (textHeight + 2 * padding).toString());
    tooltipRect.setAttribute('stroke', edge.color);
    
    tooltip.style.display = 'block';
  }

  private onEdgeLeave(): void {
    this.hoveredEdgeId = null;
    const svg = this.svgContainer.nativeElement;
    
    // Remove all blur and highlight classes
    svg.querySelectorAll('.node-group, .edge-group').forEach(el => {
      el.classList.remove('blurred', 'highlighted');
    });
    
    // Hide tooltip
    const tooltip = svg.querySelector('#edge-tooltip') as SVGElement;
    if (tooltip) {
      tooltip.style.display = 'none';
    }
  }

  private onNodeHover(nodeId: string): void {
    this.hoveredNodeId = nodeId;
    const svg = this.svgContainer.nativeElement;

    // Add blur to all elements
    svg.querySelectorAll('.node-group, .edge-group').forEach(el => {
      el.classList.add('blurred');
    });

    // Remove blur from hovered node
    const hoveredNode = svg.querySelector(`[data-node-id="${nodeId}"]`);
    if (hoveredNode) {
      hoveredNode.classList.remove('blurred');
      hoveredNode.classList.add('highlighted');
    }

    // Find and highlight outgoing edges and their target nodes
    this.edges.forEach(edge => {
      if (edge.source === nodeId) {
        const edgeElement = svg.querySelector(`[data-edge-id="${edge.id}"]`);
        if (edgeElement) {
          edgeElement.classList.remove('blurred');
          edgeElement.classList.add('highlighted');
        }
        
        // Highlight target node
        const targetNode = svg.querySelector(`[data-node-id="${edge.target}"]`);
        if (targetNode) {
          targetNode.classList.remove('blurred');
        }
      }
    });
  }

  private onNodeLeave(): void {
    this.hoveredNodeId = null;
    const svg = this.svgContainer.nativeElement;
    
    // Remove all blur and highlight classes
    svg.querySelectorAll('.node-group, .edge-group').forEach(el => {
      el.classList.remove('blurred', 'highlighted');
    });
  }
}
