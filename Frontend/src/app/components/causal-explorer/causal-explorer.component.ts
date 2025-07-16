import { Component, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OcelDataService } from '../../services/ocel-data.service';
import { OCELData, OCELEvent, OCELObject } from '../../models/ocel.model';
import { CausalVariable, CausalPath, CausalModel, NodeCategory } from '../../models/causal-graph.model';
import ELK from 'elkjs/lib/elk.bundled.js';

@Component({
  selector: 'app-causal-explorer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './causal-explorer.component.html',
  styleUrl: './causal-explorer.component.scss'
})
export class CausalExplorerComponent implements OnInit, AfterViewInit {
  @ViewChild('svgContainer', { static: false }) svgContainer!: ElementRef<SVGSVGElement>;
  
  loading = true;
  objectTypes: string[] = [];
  leadObjectType = 'MAT_PLA'; // Default lead object type

  /** Lists of available variables so the user can select which ones to display */
  availableObservedVariables = [
    { id: 'activity_diversity', name: 'Activity Diversity' },
    { id: 'activity_count', name: 'Activity Count' },
    { id: 'object_interactions', name: 'Object Interactions' },
    { id: 'object_type_diversity', name: 'Object Type Diversity' },
    { id: 'throughput_time', name: 'Throughput Time' },
    { id: 'avg_waiting_time', name: 'Avg Waiting Time' },
    { id: 'rework_ratio', name: 'Rework Ratio' },
    { id: 'interaction_density', name: 'Interaction Density' },
    { id: 'waiting_time_std', name: 'Waiting Time Std' }
  ];

  availableLatentVariables = [
    { id: 'process_complexity', name: 'Process Complexity' },
    { id: 'process_variability', name: 'Process Variability' },
    { id: 'process_performance', name: 'Process Performance' }
  ];

  selectedObservedVariables = this.availableObservedVariables.map(v => v.id);
  selectedLatentVariables = this.availableLatentVariables.map(v => v.id);
  
  causalModel: CausalModel = {
    variables: [],
    paths: [],
    leadObjectType: 'MAT_PLA'
  };
  
  // For storing computed metrics
  private metricsData: Map<string, number[]> = new Map();
  
  private elk = new ELK();
  private ocelData: OCELData | null = null;

  constructor(private ocelDataService: OcelDataService) {}

  ngOnInit(): void {
    this.ocelDataService.ocelData$.subscribe(data => {
      if (data) {
        this.ocelData = data;
        this.objectTypes = data.objectTypes.map(type => type.name);
        
        // Check if MAT_PLA exists, otherwise use first object type
        if (!this.objectTypes.includes('MAT_PLA') && this.objectTypes.length > 0) {
          this.leadObjectType = this.objectTypes[0];
        }
        
        this.computeCausalModel();
        this.loading = false;
      }
    });
  }

  ngAfterViewInit(): void {
    if (!this.loading) {
      this.renderGraph();
    }
  }

  onLeadObjectTypeChange(): void {
    if (this.ocelData) {
      this.computeCausalModel();
    }
  }

  onVariableSelectionChange(): void {
    if (this.ocelData) {
      this.computeCausalModel();
    }
  }

  private computeCausalModel(): void {
    if (!this.ocelData) return;

    const variables: CausalVariable[] = [];
    const paths: CausalPath[] = [];
    this.metricsData.clear();

    // 1. Define latent variables
    variables.push({
      id: 'process_complexity',
      name: 'Process Complexity',
      type: 'latent',
      category: 'complexity',
      indicators: []
    });
    
    variables.push({
      id: 'process_performance',
      name: 'Process Performance',
      type: 'latent',
      category: 'performance',
      indicators: []
    });

    variables.push({
      id: 'process_variability',
      name: 'Process Variability',
      type: 'latent',
      category: 'complexity',
      indicators: []
    });

    // 2. Create observed variables and compute their values
    this.createObservedVariables(variables);

    // 3. Filter variables based on user selection
    const selectedIds = new Set([
      ...this.selectedObservedVariables,
      ...this.selectedLatentVariables
    ]);
    const filteredVariables = variables.filter(v => selectedIds.has(v.id));

    // 4. Compute correlation matrix only for selected observed variables
    const correlationData = this.computeCorrelationMatrix(this.selectedObservedVariables);

    // 5. Estimate path coefficients using correlations
    this.estimatePathCoefficients(filteredVariables, paths, correlationData);

    this.causalModel = {
      variables: filteredVariables,
      paths,
      leadObjectType: this.leadObjectType,
      correlationMatrix: correlationData.matrix,
      variableNames: correlationData.names
    };
    
    // Render graph after computing
    setTimeout(() => this.renderGraph(), 100);
  }

  private createObservedVariables(variables: CausalVariable[]): void {
    // Get lead objects for case-level analysis
    const leadObjects = this.ocelData!.objects.filter(obj => obj.type === this.leadObjectType);
    
    // For each lead object, compute metrics
    const activityDiversity: number[] = [];
    const objectInteractions: number[] = [];
    const throughputTime: number[] = [];
    const activityCount: number[] = [];
    const uniqueObjectTypes: number[] = [];
    const avgWaitingTime: number[] = [];
    const reworkRatio: number[] = [];
    const interactionDensity: number[] = [];
    const waitingTimeStd: number[] = [];
    
    leadObjects.forEach(leadObj => {
      // Get all events for this lead object
      const objEvents = this.ocelData!.events
        .filter(e => e.relationships.some(r => r.objectId === leadObj.id))
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      
      if (objEvents.length > 0) {
        // Activity diversity (number of unique activities)
        const uniqueActivities = new Set(objEvents.map(e => e.type));
        activityDiversity.push(uniqueActivities.size);
        
        // Total activity count
        activityCount.push(objEvents.length);

        // Object interactions (total number of unique objects interacted with)
        const interactedObjects = new Set<string>();
        objEvents.forEach(event => {
          event.relationships.forEach(rel => {
            if (rel.objectId !== leadObj.id) {
              interactedObjects.add(rel.objectId);
            }
          });
        });
        objectInteractions.push(interactedObjects.size);

        interactionDensity.push(interactedObjects.size / objEvents.length);

        // Unique object types interacted with
        const interactedTypes = new Set<string>();
        interactedObjects.forEach(objId => {
          const obj = this.ocelData!.objects.find(o => o.id === objId);
          if (obj) interactedTypes.add(obj.type);
        });
        uniqueObjectTypes.push(interactedTypes.size);
        
        // Throughput time (first to last event)
        const firstTime = new Date(objEvents[0].time).getTime();
        const lastTime = new Date(objEvents[objEvents.length - 1].time).getTime();
        throughputTime.push(lastTime - firstTime);
        
        // Average waiting time between activities
        if (objEvents.length > 1) {
          let totalWaiting = 0;
          const waits: number[] = [];
          for (let i = 1; i < objEvents.length; i++) {
            const prevTime = new Date(objEvents[i - 1].time).getTime();
            const currTime = new Date(objEvents[i].time).getTime();
            totalWaiting += currTime - prevTime;
            waits.push(currTime - prevTime);
          }
          avgWaitingTime.push(totalWaiting / (objEvents.length - 1));
          const meanWait = totalWaiting / (objEvents.length - 1);
          const variance = waits.reduce((a, b) => a + Math.pow(b - meanWait, 2), 0) / waits.length;
          waitingTimeStd.push(Math.sqrt(variance));
        } else {
          avgWaitingTime.push(0);
          waitingTimeStd.push(0);
        }

        // Rework ratio: repeated activities divided by total activities
        const seenActs = new Map<string, number>();
        objEvents.forEach(e => seenActs.set(e.type, (seenActs.get(e.type) || 0) + 1));
        const repeats = Array.from(seenActs.values()).reduce((sum, v) => sum + Math.max(0, v - 1), 0);
        reworkRatio.push(repeats / objEvents.length);
      }
    });
    
    // Create observed variables with computed statistics
    this.addObservedVariable(variables, 'activity_diversity', 'Activity Diversity', 'complexity', activityDiversity);
    this.addObservedVariable(variables, 'activity_count', 'Activity Count', 'complexity', activityCount);
    this.addObservedVariable(variables, 'object_interactions', 'Object Interactions', 'complexity', objectInteractions);
    this.addObservedVariable(variables, 'object_type_diversity', 'Object Type Diversity', 'complexity', uniqueObjectTypes);
    this.addObservedVariable(variables, 'throughput_time', 'Throughput Time', 'performance', throughputTime);
    this.addObservedVariable(variables, 'avg_waiting_time', 'Avg Waiting Time', 'performance', avgWaitingTime);
    this.addObservedVariable(variables, 'rework_ratio', 'Rework Ratio', 'complexity', reworkRatio);
    this.addObservedVariable(variables, 'interaction_density', 'Interaction Density', 'complexity', interactionDensity);
    this.addObservedVariable(variables, 'waiting_time_std', 'Waiting Time Std', 'performance', waitingTimeStd);
    
    // Update latent variable indicators
    const complexityVar = variables.find(v => v.id === 'process_complexity');
    if (complexityVar) {
      complexityVar.indicators = ['activity_diversity', 'activity_count', 'object_interactions', 'object_type_diversity', 'interaction_density'];
    }

    const variabilityVar = variables.find(v => v.id === 'process_variability');
    if (variabilityVar) {
      variabilityVar.indicators = ['rework_ratio', 'waiting_time_std'];
    }

    const performanceVar = variables.find(v => v.id === 'process_performance');
    if (performanceVar) {
      performanceVar.indicators = ['throughput_time', 'avg_waiting_time'];
    }
  }
  
  private addObservedVariable(
    variables: CausalVariable[],
    id: string,
    name: string,
    category: NodeCategory,
    values: number[]
  ): void {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    variables.push({
      id,
      name,
      type: 'observed',
      category,
      mean,
      stdDev,
      value: mean
    });
    
    // Store standardized values for correlation computation
    const standardized = values.map(v => (v - mean) / (stdDev || 1));
    this.metricsData.set(id, standardized);
  }
  
  private computeCorrelationMatrix(selected: string[]): { matrix: number[][], names: string[] } {
    const varNames = selected.filter(v => this.metricsData.has(v));
    const n = varNames.length;
    const matrix: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          matrix[i][j] = 1;
        } else {
          const data1 = this.metricsData.get(varNames[i])!;
          const data2 = this.metricsData.get(varNames[j])!;
          matrix[i][j] = this.pearsonCorrelation(data1, data2);
        }
      }
    }
    
    return { matrix, names: varNames };
  }
  
  private pearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n === 0) return 0;
    
    // Already standardized, so just compute mean of products
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += x[i] * y[i];
    }
    
    return sum / n;
  }
  
  private estimatePathCoefficients(
    variables: CausalVariable[],
    paths: CausalPath[],
    correlationData: { matrix: number[][], names: string[] }
  ): void {
    // Create paths from observed to latent variables (factor loadings)
    const complexityIndicators = ['activity_diversity', 'activity_count', 'object_interactions', 'object_type_diversity', 'interaction_density'];
    const variabilityIndicators = ['rework_ratio', 'waiting_time_std'];
    const performanceIndicators = ['throughput_time', 'avg_waiting_time'];

    const selComplexity = complexityIndicators.filter(i => this.selectedObservedVariables.includes(i));
    const selVariability = variabilityIndicators.filter(i => this.selectedObservedVariables.includes(i));
    const selPerformance = performanceIndicators.filter(i => this.selectedObservedVariables.includes(i));

    // Estimate factor loadings using correlations
    selComplexity.forEach(indicator => {
      const loading = this.estimateFactorLoading(indicator, selComplexity, correlationData);
      paths.push({
        id: `path_complexity_${indicator}`,
        source: 'process_complexity',
        target: indicator,
        coefficient: loading,
        isSignificant: Math.abs(loading) > 0.3
      });
    });

    selVariability.forEach(indicator => {
      const loading = this.estimateFactorLoading(indicator, selVariability, correlationData);
      paths.push({
        id: `path_variability_${indicator}`,
        source: 'process_variability',
        target: indicator,
        coefficient: loading,
        isSignificant: Math.abs(loading) > 0.3
      });
    });

    selPerformance.forEach(indicator => {
      const loading = this.estimateFactorLoading(indicator, selPerformance, correlationData);
      // Reverse sign for waiting time (negative impact on performance)
      const adjustedLoading = indicator === 'avg_waiting_time' ? -Math.abs(loading) : loading;
      paths.push({
        id: `path_performance_${indicator}`,
        source: 'process_performance',
        target: indicator,
        coefficient: adjustedLoading,
        isSignificant: Math.abs(adjustedLoading) > 0.3
      });
    });

    // Structural paths between latent variables
    if (this.selectedLatentVariables.includes('process_complexity') && this.selectedLatentVariables.includes('process_performance')) {
      const complexityPerformanceCoef = this.estimateStructuralCoefficient(
        selComplexity,
        selPerformance,
        correlationData
      );

      paths.push({
        id: 'path_complexity_performance',
        source: 'process_complexity',
        target: 'process_performance',
        coefficient: complexityPerformanceCoef,
        isSignificant: Math.abs(complexityPerformanceCoef) > 0.2
      });
    }

    if (this.selectedLatentVariables.includes('process_variability') && this.selectedLatentVariables.includes('process_performance')) {
      const variabilityPerformanceCoef = this.estimateStructuralCoefficient(
        selVariability,
        selPerformance,
        correlationData
      );

      paths.push({
        id: 'path_variability_performance',
        source: 'process_variability',
        target: 'process_performance',
        coefficient: variabilityPerformanceCoef,
        isSignificant: Math.abs(variabilityPerformanceCoef) > 0.2
      });
    }
  }
  
  private estimateFactorLoading(
    indicator: string,
    allIndicators: string[],
    correlationData: { matrix: number[][], names: string[] }
  ): number {
    // Simple estimation: average correlation with other indicators
    const idx = correlationData.names.indexOf(indicator);
    if (idx === -1) return 0;
    
    let sum = 0;
    let count = 0;
    
    allIndicators.forEach(other => {
      if (other !== indicator) {
        const otherIdx = correlationData.names.indexOf(other);
        if (otherIdx !== -1) {
          sum += Math.abs(correlationData.matrix[idx][otherIdx]);
          count++;
        }
      }
    });
    
    return count > 0 ? Math.sqrt(sum / count) : 0;
  }
  
  private estimateStructuralCoefficient(
    predictorIndicators: string[],
    outcomeIndicators: string[],
    correlationData: { matrix: number[][], names: string[] }
  ): number {
    // Estimate by averaging cross-correlations
    let sum = 0;
    let count = 0;
    
    predictorIndicators.forEach(pred => {
      const predIdx = correlationData.names.indexOf(pred);
      if (predIdx === -1) return;
      
      outcomeIndicators.forEach(outcome => {
        const outIdx = correlationData.names.indexOf(outcome);
        if (outIdx !== -1) {
          // Adjust sign based on expected relationship
          const corr = correlationData.matrix[predIdx][outIdx];
          const adjustedCorr = outcome === 'avg_waiting_time' ? -corr : -corr;
          sum += adjustedCorr;
          count++;
        }
      });
    });
    
    return count > 0 ? sum / count : 0;
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
      return `${minutes}m`;
    } else {
      return `${seconds}s`;
    }
  }

  private async renderGraph(): Promise<void> {
    if (!this.svgContainer || this.causalModel.variables.length === 0) return;

    // Prepare ELK graph for SEM diagram
    const elkGraph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.layered.spacing.nodeNodeBetweenLayers': '150',
        'elk.spacing.nodeNode': '80',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN'
      },
      children: this.causalModel.variables.map(variable => ({
        id: variable.id,
        width: variable.type === 'latent' ? 180 : 140,
        height: variable.type === 'latent' ? 80 : 60,
        labels: [{ text: variable.name }]
      })),
      edges: this.causalModel.paths.map(path => ({
        id: path.id,
        sources: [path.source],
        targets: [path.target]
      }))
    };

    try {
      const layout = await this.elk.layout(elkGraph);
      this.drawSEMDiagram(layout);
    } catch (error) {
      console.error('Error laying out SEM diagram:', error);
    }
  }

  private drawSEMDiagram(layout: any): void {
    const svg = this.svgContainer.nativeElement;
    svg.innerHTML = '';

    // Set viewBox and dimensions
    const padding = 50;
    const width = layout.width + 2 * padding;
    const height = layout.height + 2 * padding;
    svg.setAttribute('viewBox', `${-padding} ${-padding} ${width} ${height}`);
    svg.setAttribute('width', width.toString());
    svg.setAttribute('height', height.toString());

    // Add arrow marker definition
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', '0 0, 10 3, 0 6');
    polygon.setAttribute('fill', '#666');
    
    marker.appendChild(polygon);
    defs.appendChild(marker);
    svg.appendChild(defs);

    // Draw edges (paths)
    const edgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    edgeGroup.setAttribute('class', 'edges');
    
    layout.edges.forEach((edge: any) => {
      const causalPath = this.causalModel.paths.find(p => p.id === edge.id);
      if (!causalPath) return;

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
      path.setAttribute('stroke', causalPath.isSignificant ? '#333' : '#999');
      path.setAttribute('stroke-width', causalPath.isSignificant ? '2' : '1');
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', 'url(#arrowhead)');
      path.setAttribute('stroke-dasharray', causalPath.isSignificant ? 'none' : '5,5');
      
      edgeGroup.appendChild(path);

      // Add coefficient label - calculate midpoint along the actual path
      let midX, midY;
      if (points.length > 0) {
        // If there are bend points, use the middle bend point or calculate between two middle points
        const midIndex = Math.floor(points.length / 2);
        if (points.length % 2 === 1) {
          // Odd number of bend points - use the middle one
          midX = points[midIndex].x;
          midY = points[midIndex].y;
        } else {
          // Even number of bend points - calculate between two middle ones
          const p1 = points[midIndex - 1];
          const p2 = points[midIndex];
          midX = (p1.x + p2.x) / 2;
          midY = (p1.y + p2.y) / 2;
        }
      } else {
        // No bend points - use midpoint between start and end
        midX = (startPoint.x + endPoint.x) / 2;
        midY = (startPoint.y + endPoint.y) / 2;
      }
      
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', midX.toString());
      label.setAttribute('y', (midY - 5).toString());
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', '11');
      label.setAttribute('fill', '#333');
      label.setAttribute('font-weight', causalPath.isSignificant ? 'bold' : 'normal');
      label.textContent = causalPath.coefficient.toFixed(2);
      
      // Add background for better readability
      const bbox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bbox.setAttribute('x', (midX - 15).toString());
      bbox.setAttribute('y', (midY - 15).toString());
      bbox.setAttribute('width', '30');
      bbox.setAttribute('height', '20');
      bbox.setAttribute('fill', 'white');
      bbox.setAttribute('opacity', '0.8');
      
      edgeGroup.appendChild(bbox);
      edgeGroup.appendChild(label);
    });
    
    svg.appendChild(edgeGroup);

    // Draw nodes (variables)
    const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    nodeGroup.setAttribute('class', 'nodes');
    
    layout.children.forEach((node: any) => {
      const variable = this.causalModel.variables.find(v => v.id === node.id);
      if (!variable) return;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      
      if (variable.type === 'latent') {
        // Draw ellipse for latent variables
        const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        ellipse.setAttribute('cx', (node.x + node.width / 2).toString());
        ellipse.setAttribute('cy', (node.y + node.height / 2).toString());
        ellipse.setAttribute('rx', (node.width / 2).toString());
        ellipse.setAttribute('ry', (node.height / 2).toString());
        ellipse.setAttribute('fill', '#f0f0f0');
        ellipse.setAttribute('stroke', '#333');
        ellipse.setAttribute('stroke-width', '2');
        g.appendChild(ellipse);
      } else {
        // Draw rectangle for observed variables
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', node.x.toString());
        rect.setAttribute('y', node.y.toString());
        rect.setAttribute('width', node.width.toString());
        rect.setAttribute('height', node.height.toString());
        
        // Color based on category
        let fillColor = '#fff';
        let strokeColor = '#333';
        if (variable.category === 'complexity') {
          fillColor = '#e3f2fd';
          strokeColor = '#1976d2';
        } else if (variable.category === 'performance') {
          fillColor = '#f3e5f5';
          strokeColor = '#7b1fa2';
        }
        
        rect.setAttribute('fill', fillColor);
        rect.setAttribute('stroke', strokeColor);
        rect.setAttribute('stroke-width', '2');
        rect.setAttribute('rx', '5');
        g.appendChild(rect);
      }

      // Add variable name
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', (node.x + node.width / 2).toString());
      text.setAttribute('y', (node.y + node.height / 2 - 5).toString());
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '12');
      text.setAttribute('fill', '#333');
      text.setAttribute('font-weight', variable.type === 'latent' ? 'bold' : 'normal');
      text.textContent = variable.name;
      g.appendChild(text);
      
      // Add mean value for observed variables
      if (variable.type === 'observed' && variable.mean !== undefined) {
        const meanText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        meanText.setAttribute('x', (node.x + node.width / 2).toString());
        meanText.setAttribute('y', (node.y + node.height / 2 + 10).toString());
        meanText.setAttribute('text-anchor', 'middle');
        meanText.setAttribute('font-size', '10');
        meanText.setAttribute('fill', '#666');
        
        // Format mean based on variable
        let formattedMean = '';
        if (variable.id.includes('time')) {
          formattedMean = `μ=${this.formatDuration(variable.mean)}`;
        } else {
          formattedMean = `μ=${variable.mean.toFixed(1)}`;
        }
        meanText.textContent = formattedMean;
        g.appendChild(meanText);
      }
      
      nodeGroup.appendChild(g);
    });
    
    svg.appendChild(nodeGroup);

    // Add correlation matrix display if available
    if (this.causalModel.correlationMatrix && this.causalModel.variableNames) {
      this.addCorrelationMatrix(svg, width, height);
    }
  }

  private addCorrelationMatrix(svg: SVGSVGElement, totalWidth: number, totalHeight: number): void {
    const matrix = this.causalModel.correlationMatrix!;
    const names = this.causalModel.variableNames!;
    const cellSize = 30;
    const matrixSize = names.length * cellSize;
    const startX = totalWidth - matrixSize - 100;
    const startY = 20;
    
    const matrixGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    matrixGroup.setAttribute('transform', `translate(${startX}, ${startY})`);
    
    // Title
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    title.setAttribute('x', (matrixSize / 2).toString());
    title.setAttribute('y', '-10');
    title.setAttribute('text-anchor', 'middle');
    title.setAttribute('font-size', '14');
    title.setAttribute('font-weight', 'bold');
    title.textContent = 'Correlation Matrix';
    matrixGroup.appendChild(title);
    
    // Draw cells
    for (let i = 0; i < names.length; i++) {
      for (let j = 0; j < names.length; j++) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', (j * cellSize).toString());
        rect.setAttribute('y', (i * cellSize).toString());
        rect.setAttribute('width', cellSize.toString());
        rect.setAttribute('height', cellSize.toString());
        
        // Color based on correlation value
        const corr = matrix[i][j];
        const intensity = Math.abs(corr);
        let color = '';
        if (corr > 0) {
          color = `rgba(33, 150, 243, ${intensity})`;
        } else {
          color = `rgba(244, 67, 54, ${intensity})`;
        }
        
        rect.setAttribute('fill', color);
        rect.setAttribute('stroke', '#ddd');
        rect.setAttribute('stroke-width', '1');
        matrixGroup.appendChild(rect);
        
        // Add correlation value
        if (i !== j) {
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', (j * cellSize + cellSize / 2).toString());
          text.setAttribute('y', (i * cellSize + cellSize / 2 + 3).toString());
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('font-size', '9');
          text.setAttribute('fill', intensity > 0.7 ? 'white' : 'black');
          text.textContent = corr.toFixed(2);
          matrixGroup.appendChild(text);
        }
      }
    }
    
    // Add labels
    names.forEach((name, i) => {
      // Row labels
      const rowLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      rowLabel.setAttribute('x', '-5');
      rowLabel.setAttribute('y', (i * cellSize + cellSize / 2 + 3).toString());
      rowLabel.setAttribute('text-anchor', 'end');
      rowLabel.setAttribute('font-size', '9');
      rowLabel.textContent = this.truncateLabel(name);
      matrixGroup.appendChild(rowLabel);
      
      // Column labels
      const colLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      colLabel.setAttribute('x', (i * cellSize + cellSize / 2).toString());
      colLabel.setAttribute('y', (matrixSize + 15).toString());
      colLabel.setAttribute('text-anchor', 'middle');
      colLabel.setAttribute('font-size', '9');
      colLabel.setAttribute('transform', `rotate(45 ${i * cellSize + cellSize / 2} ${matrixSize + 15})`);
      colLabel.textContent = this.truncateLabel(name);
      matrixGroup.appendChild(colLabel);
    });
    
    svg.appendChild(matrixGroup);
  }
  
  private truncateLabel(label: string): string {
    const map: Record<string, string> = {
      'activity_diversity': 'Act Div',
      'activity_count': 'Act Cnt',
      'object_interactions': 'Obj Int',
      'object_type_diversity': 'Obj Div',
      'throughput_time': 'Thr Time',
      'avg_waiting_time': 'Wait Time',
      'rework_ratio': 'Rework',
      'interaction_density': 'Int Den',
      'waiting_time_std': 'Wait SD'
    };
    return map[label] || label;
  }
}
