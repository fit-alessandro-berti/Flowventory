import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OcelDataService } from '../../services/ocel-data.service';
import { OCELEvent, OCELData } from '../../models/ocel.model';

interface EventMetrics {
  beforeUnderOver2: number;
  beforeGoodsIssue2: number;
  beforeGoodsReceipt2: number;
  beforeStChange2: number;
  beforeStockDiff2: number;
  beforeUnderOver4: number;
  beforeGoodsIssue4: number;
  beforeGoodsReceipt4: number;
  beforeStChange4: number;
  beforeStockDiff4: number;
  afterUnderOver2: number;
  afterGoodsIssue2: number;
  afterGoodsReceipt2: number;
  afterStChange2: number;
  afterStockDiff2: number;
  afterUnderOver4: number;
  afterGoodsIssue4: number;
  afterGoodsReceipt4: number;
  afterStChange4: number;
  afterStockDiff4: number;
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
    before2: { underOver: 0, goodsIssue: 0, goodsReceipt: 0, stChange: 0, stockDiff: 0 },
    after2: { underOver: 0, goodsIssue: 0, goodsReceipt: 0, stChange: 0, stockDiff: 0 },
    before4: { underOver: 0, goodsIssue: 0, goodsReceipt: 0, stChange: 0, stockDiff: 0 },
    after4: { underOver: 0, goodsIssue: 0, goodsReceipt: 0, stChange: 0, stockDiff: 0 }
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

    const b2_underOver = events.map(e => this.metricsMap.get(e.id)?.beforeUnderOver2 || 0);
    const b2_GI = events.map(e => this.metricsMap.get(e.id)?.beforeGoodsIssue2 || 0);
    const b2_GR = events.map(e => this.metricsMap.get(e.id)?.beforeGoodsReceipt2 || 0);
    const b2_ST = events.map(e => this.metricsMap.get(e.id)?.beforeStChange2 || 0);
    const b2_Diff = events.map(e => this.metricsMap.get(e.id)?.beforeStockDiff2 || 0);
    const a2_underOver = events.map(e => this.metricsMap.get(e.id)?.afterUnderOver2 || 0);
    const a2_GI = events.map(e => this.metricsMap.get(e.id)?.afterGoodsIssue2 || 0);
    const a2_GR = events.map(e => this.metricsMap.get(e.id)?.afterGoodsReceipt2 || 0);
    const a2_ST = events.map(e => this.metricsMap.get(e.id)?.afterStChange2 || 0);
    const a2_Diff = events.map(e => this.metricsMap.get(e.id)?.afterStockDiff2 || 0);

    const b4_underOver = events.map(e => this.metricsMap.get(e.id)?.beforeUnderOver4 || 0);
    const b4_GI = events.map(e => this.metricsMap.get(e.id)?.beforeGoodsIssue4 || 0);
    const b4_GR = events.map(e => this.metricsMap.get(e.id)?.beforeGoodsReceipt4 || 0);
    const b4_ST = events.map(e => this.metricsMap.get(e.id)?.beforeStChange4 || 0);
    const b4_Diff = events.map(e => this.metricsMap.get(e.id)?.beforeStockDiff4 || 0);
    const a4_underOver = events.map(e => this.metricsMap.get(e.id)?.afterUnderOver4 || 0);
    const a4_GI = events.map(e => this.metricsMap.get(e.id)?.afterGoodsIssue4 || 0);
    const a4_GR = events.map(e => this.metricsMap.get(e.id)?.afterGoodsReceipt4 || 0);
    const a4_ST = events.map(e => this.metricsMap.get(e.id)?.afterStChange4 || 0);
    const a4_Diff = events.map(e => this.metricsMap.get(e.id)?.afterStockDiff4 || 0);

    this.correlations.before2.underOver = this.pearson(b2_underOver, y);
    this.correlations.before2.goodsIssue = this.pearson(b2_GI, y);
    this.correlations.before2.goodsReceipt = this.pearson(b2_GR, y);
    this.correlations.before2.stChange = this.pearson(b2_ST, y);
    this.correlations.before2.stockDiff = this.pearson(b2_Diff, y);

    this.correlations.after2.underOver = this.pearson(a2_underOver, y);
    this.correlations.after2.goodsIssue = this.pearson(a2_GI, y);
    this.correlations.after2.goodsReceipt = this.pearson(a2_GR, y);
    this.correlations.after2.stChange = this.pearson(a2_ST, y);
    this.correlations.after2.stockDiff = this.pearson(a2_Diff, y);

    this.correlations.before4.underOver = this.pearson(b4_underOver, y);
    this.correlations.before4.goodsIssue = this.pearson(b4_GI, y);
    this.correlations.before4.goodsReceipt = this.pearson(b4_GR, y);
    this.correlations.before4.stChange = this.pearson(b4_ST, y);
    this.correlations.before4.stockDiff = this.pearson(b4_Diff, y);

    this.correlations.after4.underOver = this.pearson(a4_underOver, y);
    this.correlations.after4.goodsIssue = this.pearson(a4_GI, y);
    this.correlations.after4.goodsReceipt = this.pearson(a4_GR, y);
    this.correlations.after4.stChange = this.pearson(a4_ST, y);
    this.correlations.after4.stockDiff = this.pearson(a4_Diff, y);
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
    const ms4w = 28 * 24 * 60 * 60 * 1000;

    this.metricsMap.clear();
    // initialize metrics with zeros for all events so that missing data does not
    // cause runtime errors when the log is heavily filtered
    this.ocelData.events.forEach(ev => {
      this.metricsMap.set(ev.id, {
        beforeUnderOver2: 0,
        beforeGoodsIssue2: 0,
        beforeGoodsReceipt2: 0,
        beforeStChange2: 0,
        beforeStockDiff2: 0,
        beforeUnderOver4: 0,
        beforeGoodsIssue4: 0,
        beforeGoodsReceipt4: 0,
        beforeStChange4: 0,
        beforeStockDiff4: 0,
        afterUnderOver2: 0,
        afterGoodsIssue2: 0,
        afterGoodsReceipt2: 0,
        afterStChange2: 0,
        afterStockDiff2: 0,
        afterUnderOver4: 0,
        afterGoodsIssue4: 0,
        afterGoodsReceipt4: 0,
        afterStChange4: 0,
        afterStockDiff4: 0
      });
    });

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

      let start2 = 0, start4 = 0;
      let gi2 = 0, gr2 = 0, st2 = 0, status2 = 0;
      let gi4 = 0, gr4 = 0, st4 = 0, status4 = 0;
      for (let i = 0; i < list.length; i++) {
        const t = times[i];
        while (times[start2] < t - ms2w) {
          if (isGI[start2]) gi2--;
          if (isGR[start2]) gr2--;
          if (isST[start2]) st2--;
          if (statusFlags[start2]) status2--;
          start2++;
        }
        while (times[start4] < t - ms4w) {
          if (isGI[start4]) gi4--;
          if (isGR[start4]) gr4--;
          if (isST[start4]) st4--;
          if (statusFlags[start4]) status4--;
          start4++;
        }
        const prev2 = start2 - 1;
        const prev4 = start4 - 1;
        const diff2 = prev2 >= 0 ? stockBefore[i] - stockAfter[prev2] : 0;
        const diff4 = prev4 >= 0 ? stockBefore[i] - stockAfter[prev4] : 0;
        const metrics: EventMetrics = {
          beforeUnderOver2: status2 > 0 ? 1 : 0,
          beforeGoodsIssue2: gi2,
          beforeGoodsReceipt2: gr2,
          beforeStChange2: st2,
          beforeStockDiff2: diff2,
          beforeUnderOver4: status4 > 0 ? 1 : 0,
          beforeGoodsIssue4: gi4,
          beforeGoodsReceipt4: gr4,
          beforeStChange4: st4,
          beforeStockDiff4: diff4,
          afterUnderOver2: 0,
          afterGoodsIssue2: 0,
          afterGoodsReceipt2: 0,
          afterStChange2: 0,
          afterStockDiff2: 0,
          afterUnderOver4: 0,
          afterGoodsIssue4: 0,
          afterGoodsReceipt4: 0,
          afterStChange4: 0,
          afterStockDiff4: 0
        };
        this.metricsMap.set(list[i].id, metrics);
        if (isGI[i]) { gi2++; gi4++; }
        if (isGR[i]) { gr2++; gr4++; }
        if (isST[i]) { st2++; st4++; }
        if (statusFlags[i]) { status2++; status4++; }
      }

      // compute future metrics
      let end2 = list.length - 1, end4 = list.length - 1;
      gi2 = 0; gr2 = 0; st2 = 0; status2 = 0;
      gi4 = 0; gr4 = 0; st4 = 0; status4 = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        const t = times[i];
        while (times[end2] > t + ms2w) {
          if (isGI[end2]) gi2--;
          if (isGR[end2]) gr2--;
          if (isST[end2]) st2--;
          if (statusFlags[end2]) status2--;
          end2--;
        }
        while (times[end4] > t + ms4w) {
          if (isGI[end4]) gi4--;
          if (isGR[end4]) gr4--;
          if (isST[end4]) st4--;
          if (statusFlags[end4]) status4--;
          end4--;
        }
        const m = this.metricsMap.get(list[i].id)!;
        m.afterUnderOver2 = status2 > 0 ? 1 : 0;
        m.afterGoodsIssue2 = gi2;
        m.afterGoodsReceipt2 = gr2;
        m.afterStChange2 = st2;
        const next2 = end2 + 1;
        m.afterStockDiff2 = next2 < list.length ? stockBefore[next2] - stockAfter[i] : 0;

        m.afterUnderOver4 = status4 > 0 ? 1 : 0;
        m.afterGoodsIssue4 = gi4;
        m.afterGoodsReceipt4 = gr4;
        m.afterStChange4 = st4;
        const next4 = end4 + 1;
        m.afterStockDiff4 = next4 < list.length ? stockBefore[next4] - stockAfter[i] : 0;

        if (isGI[i]) { gi2++; gi4++; }
        if (isGR[i]) { gr2++; gr4++; }
        if (isST[i]) { st2++; st4++; }
        if (statusFlags[i]) { status2++; status4++; }
      }
    });
  }
}
