import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { OCELData, OCELEvent, OCELObject } from '../models/ocel.model';

@Injectable({
  providedIn: 'root'
})
export class OcelDataService {
  private baseData: OCELData | null = null;
  private ocelDataSubject = new BehaviorSubject<OCELData | null>(null);
  public ocelData$ = this.ocelDataSubject.asObservable();

  private filterSubject = new BehaviorSubject<{ id: number; label: string; objectType: string }[]>([]);
  public filters$ = this.filterSubject.asObservable();

  private filters: { id: number; label: string; objectType: string; objectIds: Set<string> }[] = [];
  private nextFilterId = 1;

  constructor(private http: HttpClient) {
    this.loadOCELData();
  }

  private loadOCELData(): void {
    this.http.get<OCELData>('/assets/example_ocel.json').subscribe({
      next: (data) => {
        this.baseData = data;
        this.ocelDataSubject.next(data);
      },
      error: (error) => {
        console.error('Error loading OCEL data:', error);
      }
    });
  }

  getEvents(): Observable<OCELEvent[]> {
    return new Observable(observer => {
      this.ocelData$.subscribe(data => {
        if (data) {
          observer.next(data.events);
        }
      });
    });
  }

  addFilter(label: string, objectType: string, objectIds: string[]): void {
    const id = this.nextFilterId++;
    this.filters.push({ id, label, objectType, objectIds: new Set(objectIds) });
    this.emitFilters();
    this.updateFilteredData();
  }

  removeFilter(filterId: number): void {
    this.filters = this.filters.filter(f => f.id !== filterId);
    this.emitFilters();
    this.updateFilteredData();
  }

  private emitFilters(): void {
    const toEmit = this.filters.map(f => ({
      id: f.id,
      label: f.label,
      objectType: f.objectType
    }));
    this.filterSubject.next(toEmit);
  }

  private updateFilteredData(): void {
    if (!this.baseData) return;
    if (this.filters.length === 0) {
      this.ocelDataSubject.next(this.baseData);
      return;
    }

    const triggerIds = new Set<string>();
    this.filters.forEach(f => {
      f.objectIds.forEach(id => {
        triggerIds.add(id);
        this.baseData!.events.forEach(ev => {
          if (ev.relationships.some(r => r.objectId === id)) {
            ev.relationships.forEach(r => triggerIds.add(r.objectId));
          }
        });
      });
    });

    const filteredEvents = this.baseData.events.filter(ev =>
      ev.relationships.some(r => triggerIds.has(r.objectId))
    );

    const finalIds = new Set<string>();
    filteredEvents.forEach(ev => ev.relationships.forEach(r => finalIds.add(r.objectId)));

    const filteredObjects = this.baseData.objects.filter(obj => finalIds.has(obj.id));

    const filteredData: OCELData = {
      ...this.baseData,
      events: filteredEvents,
      objects: filteredObjects
    };

    this.ocelDataSubject.next(filteredData);
  }

  getObjectById(id: string): OCELObject | undefined {
    const data = this.ocelDataSubject.value;
    return data?.objects.find(obj => obj.id === id);
  }

  getObjectTypes(): string[] {
    const data = this.ocelDataSubject.value;
    return data?.objectTypes.map(type => type.name) || [];
  }
}
