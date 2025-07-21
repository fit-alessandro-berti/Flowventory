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
  /** which tab is currently active */
  activeTab: 'graph' | 'legend' = 'graph';
  objectTypes: string[] = [];
  leadObjectType = 'MAT_PLA'; // Default lead object type

  /** Lists of available variables so the user can select which ones to display */
  /** Inventory-specific observed metrics */
  availableObservedVariables = [
    { id: 'stockout_freq', name: 'Stock-out Frequency' },
    { id: 'avg_stockout_dur', name: 'Avg Stock-out Duration' },
    { id: 'overstock_exposure', name: 'Overstock Exposure' },
    { id: 'stability_ratio', name: 'Stability Ratio' },
    { id: 'status_switch_rate', name: 'Status-switch Rate' },
    { id: 'repl_median_gap', name: 'Median Replenishment Interval' },
    { id: 'repl_mean_size', name: 'Mean Replenishment Size' },
    { id: 'repl_overshoot_rate', name: 'Replenishment Overshoot Rate' },
    { id: 'avg_daily_consumption', name: 'Avg Daily Consumption' },
    { id: 'days_of_supply', name: 'Days of Supply' },
    { id: 'demand_cv', name: 'Demand CV' },
    { id: 'demand_acf1', name: 'Lag-1 Autocorr' },
    { id: 'cons_gap_mean', name: 'Avg Inter-consumption Gap' },
    { id: 'cons_gap_cv', name: 'Gap CV' },
    { id: 'demand_entropy', name: 'Demand Entropy' }
  ];

  /** Latent variables for inventory analysis */
  availableLatentVariables = [
    { id: 'stock_health', name: 'Stock Health' },
    { id: 'repl_efficiency', name: 'Replenishment Efficiency' },
    { id: 'demand_predictability', name: 'Demand Predictability' }
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


  onObservedToggle(id: string, checked: boolean): void {
    if (checked) {
      if (!this.selectedObservedVariables.includes(id)) {
        this.selectedObservedVariables.push(id);
      }
    } else {
      this.selectedObservedVariables = this.selectedObservedVariables.filter(v => v !== id);
    }
  }

  onLatentToggle(id: string, checked: boolean): void {
    if (checked) {
      if (!this.selectedLatentVariables.includes(id)) {
        this.selectedLatentVariables.push(id);
      }
    } else {
      this.selectedLatentVariables = this.selectedLatentVariables.filter(v => v !== id);
    }
  }

  onRedrawClick(): void {
    if (this.ocelData) {
      this.computeCausalModel();
    }
  }

  switchTab(tab: 'graph' | 'legend'): void {
    this.activeTab = tab;
    if (tab === 'graph') {
      setTimeout(() => this.renderGraph());
    }
  }

  private computeCausalModel(): void {
    if (!this.ocelData) return;

    const variables: CausalVariable[] = [];
    const paths: CausalPath[] = [];
    this.metricsData.clear();

    // 1. Define latent variables
    variables.push({
      id: 'stock_health',
      name: 'Stock Health',
      type: 'latent',
      category: 'performance',
      indicators: []
    });

    variables.push({
      id: 'repl_efficiency',
      name: 'Replenishment Efficiency',
      type: 'latent',
      category: 'performance',
      indicators: []
    });

    variables.push({
      id: 'demand_predictability',
      name: 'Demand Predictability',
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
    const msDay = 24 * 60 * 60 * 1000;
    const leadObjects = this.ocelData!.objects.filter(o => o.type === this.leadObjectType);
    const typeById = new Map<string, string>();
    this.ocelData!.objects.forEach(o => typeById.set(o.id, o.type));

    const stockoutFreq: number[] = [];
    const avgStockoutDur: number[] = [];
    const overstockExposure: number[] = [];
    const stabilityRatio: number[] = [];
    const statusSwitchRate: number[] = [];
    const replMedianGap: number[] = [];
    const replMeanSize: number[] = [];
    const replOvershootRate: number[] = [];
    const avgDailyCons: number[] = [];
    const daysOfSupply: number[] = [];
    const demandCv: number[] = [];
    const demandAcf1: number[] = [];
    const consGapMean: number[] = [];
    const consGapCv: number[] = [];
    const demandEntropy: number[] = [];

    leadObjects.forEach(obj => {
      const objEvents = this.ocelData!.events
        .filter(e => e.relationships.some(r => r.objectId === obj.id))
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      if (objEvents.length < 2) {
        stockoutFreq.push(0);
        avgStockoutDur.push(0);
        overstockExposure.push(0);
        stabilityRatio.push(0);
        statusSwitchRate.push(0);
        replMedianGap.push(0);
        replMeanSize.push(0);
        replOvershootRate.push(0);
        avgDailyCons.push(0);
        daysOfSupply.push(0);
        demandCv.push(0);
        demandAcf1.push(0);
        consGapMean.push(0);
        consGapCv.push(0);
        demandEntropy.push(0);
        return;
      }

      const times = objEvents.map(e => new Date(e.time).getTime());
      const statuses = objEvents.map(e => String(e.attributes.find(a => a.name === 'Current Status')?.value || ''));
      const stocks = objEvents.map(e => parseFloat(String(e.attributes.find(a => a.name === 'Stock After')?.value || '0')));

      let overstockTime = 0;
      let normalTime = 0;
      let statusSwitches = 0;
      let stockoutEntries = 0;
      const stockoutDurations: number[] = [];
      let startUnder: number | null = null;

      const replIntervals: number[] = [];
      const replSizes: number[] = [];
      let replOvershoot = 0;
      let replCount = 0;

      const dailyCons = new Map<string, number>();
      const consTimes: number[] = [];

      for (let i = 1; i < objEvents.length; i++) {
        const dt = times[i] - times[i - 1];
        // time spent in previous status
        if (statuses[i - 1] === 'Overstock') overstockTime += dt;
        if (statuses[i - 1] === 'Normal') normalTime += dt;

        if (statuses[i] !== statuses[i - 1]) {
          statusSwitches++;
          if (statuses[i] === 'Understock') {
            stockoutEntries++;
            startUnder = times[i];
          } else if (statuses[i - 1] === 'Understock' && startUnder !== null) {
            stockoutDurations.push(times[i] - startUnder);
            startUnder = null;
          }
        }

        const deltaStock = stocks[i] - stocks[i - 1];
        const isRepl = deltaStock > 0 && objEvents[i].relationships.some(r => typeById.get(r.objectId) === 'PO_ITEM');
        if (isRepl) {
          replIntervals.push(dt / msDay);
          replSizes.push(deltaStock);
          replCount++;
          if (statuses[i] === 'Overstock') replOvershoot++;
        } else if (deltaStock < 0) {
          const dayKey = new Date(times[i]).toISOString().slice(0, 10);
          dailyCons.set(dayKey, (dailyCons.get(dayKey) || 0) + -deltaStock);
          consTimes.push(times[i]);
        }
      }

      if (statuses[statuses.length - 1] === 'Understock' && startUnder !== null) {
        stockoutDurations.push(times[times.length - 1] - startUnder);
      }

      const totalTime = times[times.length - 1] - times[0];
      const totalDays = Math.max(totalTime / msDay, 1);

      stockoutFreq.push(stockoutEntries / totalDays);
      const avgDur = stockoutDurations.length ? stockoutDurations.reduce((a, b) => a + b, 0) / stockoutDurations.length : 0;
      avgStockoutDur.push(avgDur);
      overstockExposure.push(totalTime ? overstockTime / totalTime : 0);
      stabilityRatio.push(totalTime ? normalTime / totalTime : 0);
      statusSwitchRate.push(statusSwitches / totalDays);

      const medGap = replIntervals.length ? replIntervals.sort((a, b) => a - b)[Math.floor(replIntervals.length / 2)] : 0;
      const meanSize = replSizes.length ? replSizes.reduce((a, b) => a + b, 0) / replSizes.length : 0;
      const overshootRate = replCount ? replOvershoot / replCount : 0;
      replMedianGap.push(medGap);
      replMeanSize.push(meanSize);
      replOvershootRate.push(overshootRate);

      const consValues = Array.from(dailyCons.values());
      const avgCons = consValues.length ? consValues.reduce((a, b) => a + b, 0) / consValues.length : 0;
      avgDailyCons.push(avgCons);
      const dosValues = stocks.map(s => avgCons ? s / avgCons : 0);
      daysOfSupply.push(dosValues.reduce((a, b) => a + b, 0) / dosValues.length);

      const meanCons = avgCons;
      const stdCons = consValues.length ? Math.sqrt(consValues.reduce((a, b) => a + Math.pow(b - meanCons, 2), 0) / consValues.length) : 0;
      demandCv.push(meanCons ? stdCons / meanCons : 0);
      if (consValues.length > 1) {
        const x = consValues.slice(0, -1);
        const y = consValues.slice(1);
        let sum = 0;
        for (let i = 0; i < x.length; i++) sum += ((x[i] - meanCons) / (stdCons || 1)) * ((y[i] - meanCons) / (stdCons || 1));
        demandAcf1.push(sum / x.length);
      } else {
        demandAcf1.push(0);
      }

      if (consTimes.length > 1) {
        const gaps = [] as number[];
        for (let i = 1; i < consTimes.length; i++) gaps.push((consTimes[i] - consTimes[i - 1]) / msDay);
        const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const stdGap = Math.sqrt(gaps.reduce((a, b) => a + Math.pow(b - meanGap, 2), 0) / gaps.length);
        consGapMean.push(meanGap);
        consGapCv.push(meanGap ? stdGap / meanGap : 0);
      } else {
        consGapMean.push(0);
        consGapCv.push(0);
      }

      const freq = new Map<number, number>();
      consValues.forEach(v => freq.set(v, (freq.get(v) || 0) + 1));
      let entropy = 0;
      freq.forEach(c => {
        const p = c / consValues.length;
        entropy -= p * Math.log2(p);
      });
      demandEntropy.push(entropy);
    });

    // Create observed variables
    this.addObservedVariable(variables, 'stockout_freq', 'Stock-out Frequency', 'performance', stockoutFreq);
    this.addObservedVariable(variables, 'avg_stockout_dur', 'Avg Stock-out Duration', 'performance', avgStockoutDur);
    this.addObservedVariable(variables, 'overstock_exposure', 'Overstock Exposure', 'performance', overstockExposure);
    this.addObservedVariable(variables, 'stability_ratio', 'Stability Ratio', 'performance', stabilityRatio);
    this.addObservedVariable(variables, 'status_switch_rate', 'Status-switch Rate', 'performance', statusSwitchRate);
    this.addObservedVariable(variables, 'repl_median_gap', 'Median Replenishment Interval', 'complexity', replMedianGap);
    this.addObservedVariable(variables, 'repl_mean_size', 'Mean Replenishment Size', 'complexity', replMeanSize);
    this.addObservedVariable(variables, 'repl_overshoot_rate', 'Replenishment Overshoot Rate', 'complexity', replOvershootRate);
    this.addObservedVariable(variables, 'avg_daily_consumption', 'Avg Daily Consumption', 'complexity', avgDailyCons);
    this.addObservedVariable(variables, 'days_of_supply', 'Days of Supply', 'complexity', daysOfSupply);
    this.addObservedVariable(variables, 'demand_cv', 'Demand CV', 'complexity', demandCv);
    this.addObservedVariable(variables, 'demand_acf1', 'Lag-1 Autocorr', 'complexity', demandAcf1);
    this.addObservedVariable(variables, 'cons_gap_mean', 'Avg Inter-consumption Gap', 'complexity', consGapMean);
    this.addObservedVariable(variables, 'cons_gap_cv', 'Gap CV', 'complexity', consGapCv);
    this.addObservedVariable(variables, 'demand_entropy', 'Demand Entropy', 'complexity', demandEntropy);

    // Latent variable indicators
    const sh = variables.find(v => v.id === 'stock_health');
    if (sh) sh.indicators = ['stockout_freq', 'avg_stockout_dur', 'overstock_exposure', 'stability_ratio', 'status_switch_rate'];
    const re = variables.find(v => v.id === 'repl_efficiency');
    if (re) re.indicators = ['repl_median_gap', 'repl_mean_size', 'repl_overshoot_rate', 'avg_daily_consumption', 'days_of_supply'];
    const dp = variables.find(v => v.id === 'demand_predictability');
    if (dp) dp.indicators = ['demand_cv', 'demand_acf1', 'cons_gap_mean', 'cons_gap_cv', 'demand_entropy'];
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
    // Factor loading indicator groups
    const shIndicators = ['stockout_freq', 'avg_stockout_dur', 'overstock_exposure', 'stability_ratio', 'status_switch_rate'];
    const reIndicators = ['repl_median_gap', 'repl_mean_size', 'repl_overshoot_rate', 'avg_daily_consumption', 'days_of_supply'];
    const dpIndicators = ['demand_cv', 'demand_acf1', 'cons_gap_mean', 'cons_gap_cv', 'demand_entropy'];

    const selSH = shIndicators.filter(i => this.selectedObservedVariables.includes(i));
    const selRE = reIndicators.filter(i => this.selectedObservedVariables.includes(i));
    const selDP = dpIndicators.filter(i => this.selectedObservedVariables.includes(i));

    if (this.selectedLatentVariables.includes('stock_health')) {
      selSH.forEach(indicator => {
        const loading = this.estimateFactorLoading(indicator, selSH, correlationData);
        paths.push({
          id: `path_sh_${indicator}`,
          source: 'stock_health',
          target: indicator,
          coefficient: loading,
          isSignificant: Math.abs(loading) > 0.3
        });
      });
    }

    if (this.selectedLatentVariables.includes('repl_efficiency')) {
      selRE.forEach(indicator => {
        const loading = this.estimateFactorLoading(indicator, selRE, correlationData);
        paths.push({
          id: `path_re_${indicator}`,
          source: 'repl_efficiency',
          target: indicator,
          coefficient: loading,
          isSignificant: Math.abs(loading) > 0.3
        });
      });
    }

    if (this.selectedLatentVariables.includes('demand_predictability')) {
      selDP.forEach(indicator => {
        const loading = this.estimateFactorLoading(indicator, selDP, correlationData);
        paths.push({
          id: `path_dp_${indicator}`,
          source: 'demand_predictability',
          target: indicator,
          coefficient: loading,
          isSignificant: Math.abs(loading) > 0.3
        });
      });
    }

    // Structural paths
    if (this.selectedLatentVariables.includes('demand_predictability') && this.selectedLatentVariables.includes('repl_efficiency')) {
      const coef = this.estimateStructuralCoefficient(selDP, selRE, correlationData);
      paths.push({
        id: 'path_dp_re',
        source: 'demand_predictability',
        target: 'repl_efficiency',
        coefficient: coef,
        isSignificant: Math.abs(coef) > 0.2
      });
    }

    if (this.selectedLatentVariables.includes('repl_efficiency') && this.selectedLatentVariables.includes('stock_health')) {
      const coef = this.estimateStructuralCoefficient(selRE, selSH, correlationData);
      paths.push({
        id: 'path_re_sh',
        source: 'repl_efficiency',
        target: 'stock_health',
        coefficient: coef,
        isSignificant: Math.abs(coef) > 0.2
      });
    }

    if (this.selectedLatentVariables.includes('demand_predictability') && this.selectedLatentVariables.includes('stock_health')) {
      const coef = this.estimateStructuralCoefficient(selDP, selSH, correlationData);
      paths.push({
        id: 'path_dp_sh',
        source: 'demand_predictability',
        target: 'stock_health',
        coefficient: coef,
        isSignificant: Math.abs(coef) > 0.2
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
          sum += correlationData.matrix[predIdx][outIdx];
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
      'stockout_freq': 'SO Freq',
      'avg_stockout_dur': 'SO Dur',
      'overstock_exposure': 'OS Exp',
      'stability_ratio': 'Stab',
      'status_switch_rate': 'Sw Rate',
      'repl_median_gap': 'Repl Gap',
      'repl_mean_size': 'Repl Size',
      'repl_overshoot_rate': 'OS Rate',
      'avg_daily_consumption': 'Avg Cons',
      'days_of_supply': 'DoS',
      'demand_cv': 'Dem CV',
      'demand_acf1': 'ACF1',
      'cons_gap_mean': 'Gap µ',
      'cons_gap_cv': 'Gap CV',
      'demand_entropy': 'Entropy'
    };
    return map[label] || label;
  }
}
