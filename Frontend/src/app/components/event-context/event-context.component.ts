import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OcelDataService } from '../../services/ocel-data.service';
import { OCELEvent, OCELData } from '../../models/ocel.model';

interface EventMetrics {
  beforeUnderOver: number;
  beforeGoodsIssue: number;
  beforeGoodsReceipt: number;
  beforeStChange: number;
  beforeStockDiff: number;
  afterUnderOver: number;
  afterGoodsIssue: number;
  afterGoodsReceipt: number;
  afterStChange: number;
  afterStockDiff: number;
}

@Component({
  selector: 'app-event-context',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './event-context.component.html',
  styleUrl: './event-context.component.scss'
})
export class EventContextComponent implements OnInit {
  loading = true;
  activities: string[] = [];
  selectedActivity = 'Goods Receipt';
  activeTab: 'before' | 'after' = 'before';

  private ocelData: OCELData | null = null;
  private metricsMap = new Map<string, EventMetrics>();

  correlations = {
    before: { underOver: 0, goodsIssue: 0, goodsReceipt: 0, stChange: 0, stockDiff: 0 },
    after: { underOver: 0, goodsIssue: 0, goodsReceipt: 0, stChange: 0, stockDiff: 0 }
  };

  constructor(private ocelDataService: OcelDataService) {}

  ngOnInit(): void {
    this.ocelDataService.ocelData$.subscribe(data => {
      if (data) {
        this.ocelData = data;
        this.activities = Array.from(
          new Set(data.events.map(e => e.type.split('(')[0].trim()))
        ).sort();
        if (!this.activities.includes(this.selectedActivity) && this.activities.length) {
          this.selectedActivity = this.activities[0];
        }
        this.computeMetrics();
        this.updateCorrelations();
        this.loading = false;
      }
    });
  }

  updateCorrelations(): void {
    if (!this.ocelData) return;
    const events = this.ocelData.events;
    const prefix = this.selectedActivity;
    const y = events.map(e => (e.type.startsWith(prefix) ? 1 : 0));

    const beforeUnderOver = events.map(e => this.metricsMap.get(e.id)!.beforeUnderOver);
    const beforeGI = events.map(e => this.metricsMap.get(e.id)!.beforeGoodsIssue);
    const beforeGR = events.map(e => this.metricsMap.get(e.id)!.beforeGoodsReceipt);
    const beforeST = events.map(e => this.metricsMap.get(e.id)!.beforeStChange);
    const beforeDiff = events.map(e => this.metricsMap.get(e.id)!.beforeStockDiff);
    const afterUnderOver = events.map(e => this.metricsMap.get(e.id)!.afterUnderOver);
    const afterGI = events.map(e => this.metricsMap.get(e.id)!.afterGoodsIssue);
    const afterGR = events.map(e => this.metricsMap.get(e.id)!.afterGoodsReceipt);
    const afterST = events.map(e => this.metricsMap.get(e.id)!.afterStChange);
    const afterDiff = events.map(e => this.metricsMap.get(e.id)!.afterStockDiff);

    this.correlations.before.underOver = this.pearson(beforeUnderOver, y);
    this.correlations.before.goodsIssue = this.pearson(beforeGI, y);
    this.correlations.before.goodsReceipt = this.pearson(beforeGR, y);
    this.correlations.before.stChange = this.pearson(beforeST, y);
    this.correlations.before.stockDiff = this.pearson(beforeDiff, y);

    this.correlations.after.underOver = this.pearson(afterUnderOver, y);
    this.correlations.after.goodsIssue = this.pearson(afterGI, y);
    this.correlations.after.goodsReceipt = this.pearson(afterGR, y);
    this.correlations.after.stChange = this.pearson(afterST, y);
    this.correlations.after.stockDiff = this.pearson(afterDiff, y);
  }

  private pearson(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n === 0) return 0;
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let denomX = 0;
    let denomY = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      num += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }
    const denom = Math.sqrt(denomX * denomY);
    return denom ? num / denom : 0;
  }

  scaleCorrelation(c: number): number {
    const sign = Math.sign(c);
    const scaled = Math.log10(1 + 9 * Math.abs(c));
    return sign * scaled;
  }

  private computeMetrics(): void {
    if (!this.ocelData) return;
    const ms2w = 14 * 24 * 60 * 60 * 1000;
    const typeById = new Map<string, string>();
    this.ocelData.objects.forEach(o => typeById.set(o.id, o.type));

    const matObjects = this.ocelData.objects.filter(o => o.type === 'MAT_PLA');
    const eventsByMat = new Map<string, OCELEvent[]>();
    matObjects.forEach(o => eventsByMat.set(o.id, []));

    this.ocelData.events.forEach(ev => {
      ev.relationships.forEach(r => {
        if (eventsByMat.has(r.objectId)) {
          eventsByMat.get(r.objectId)!.push(ev);
        }
      });
    });

    eventsByMat.forEach(list => {
      list.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      const times = list.map(e => new Date(e.time).getTime());
      const stockBefore = list.map(e => parseFloat(String(e.attributes.find(a => a.name === 'Stock Before')?.value || '0')));
      const stockAfter = list.map(e => parseFloat(String(e.attributes.find(a => a.name === 'Stock After')?.value || '0')));
      const statusFlags = list.map(e => {
        const st = String(e.attributes.find(a => a.name === 'Current Status')?.value || '');
        return st.toLowerCase() === 'understock' || st.toLowerCase() === 'overstock';
      });
      const isGI = list.map(e => e.type.startsWith('Goods Issue'));
      const isGR = list.map(e => e.type.startsWith('Goods Receipt'));
      const isST = list.map(e => e.type.startsWith('ST CHANGE'));

      let start = 0;
      let countGI = 0, countGR = 0, countST = 0, countStatus = 0;
      for (let i = 0; i < list.length; i++) {
        const t = times[i];
        while (times[start] < t - ms2w) {
          if (isGI[start]) countGI--;
          if (isGR[start]) countGR--;
          if (isST[start]) countST--;
          if (statusFlags[start]) countStatus--;
          start++;
        }
        const prevIdx = start - 1;
        const beforeDiff = prevIdx >= 0 ? stockBefore[i] - stockAfter[prevIdx] : 0;
        const metrics: EventMetrics = {
          beforeUnderOver: countStatus > 0 ? 1 : 0,
          beforeGoodsIssue: countGI,
          beforeGoodsReceipt: countGR,
          beforeStChange: countST,
          beforeStockDiff: beforeDiff,
          afterUnderOver: 0,
          afterGoodsIssue: 0,
          afterGoodsReceipt: 0,
          afterStChange: 0,
          afterStockDiff: 0
        };
        this.metricsMap.set(list[i].id, metrics);
        if (isGI[i]) countGI++;
        if (isGR[i]) countGR++;
        if (isST[i]) countST++;
        if (statusFlags[i]) countStatus++;
      }

      // compute future metrics
      let end = list.length - 1;
      countGI = 0; countGR = 0; countST = 0; countStatus = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        const t = times[i];
        while (times[end] > t + ms2w) {
          if (isGI[end]) countGI--;
          if (isGR[end]) countGR--;
          if (isST[end]) countST--;
          if (statusFlags[end]) countStatus--;
          end--;
        }
        const m = this.metricsMap.get(list[i].id)!;
        m.afterUnderOver = countStatus > 0 ? 1 : 0;
        m.afterGoodsIssue = countGI;
        m.afterGoodsReceipt = countGR;
        m.afterStChange = countST;
        const nextIdx = end + 1;
        m.afterStockDiff = nextIdx < list.length ? stockBefore[nextIdx] - stockAfter[i] : 0;
        if (isGI[i]) countGI++;
        if (isGR[i]) countGR++;
        if (isST[i]) countST++;
        if (statusFlags[i]) countStatus++;
      }
    });
  }
}
