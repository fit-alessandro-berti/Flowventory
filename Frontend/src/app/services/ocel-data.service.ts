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

  private filterSubject = new BehaviorSubject<{ id: number; label: string; objectType: string; objectIds: string[] }[]>([]);
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
    console.log('Adding filter', label, 'type', objectType, 'ids', objectIds);
    this.filters.push({ id, label, objectType, objectIds: new Set(objectIds) });
    this.emitFilters();
    this.updateFilteredData();
  }

  removeFilter(filterId: number): void {
    console.log('Removing filter with id', filterId);
    this.filters = this.filters.filter(f => f.id !== filterId);
    this.emitFilters();
    this.updateFilteredData();
  }

  private emitFilters(): void {
    const toEmit = this.filters.map(f => ({
      id: f.id,
      label: f.label,
      objectType: f.objectType,
      objectIds: Array.from(f.objectIds)
    }));
    this.filterSubject.next(toEmit);
  }

  private updateFilteredData(): void {
    if (!this.baseData) return;
    if (this.filters.length === 0) {
      console.log('No filters active, using base OCEL data');
      this.ocelDataSubject.next(this.baseData);
      return;
    }

    const RELATED_TYPES = new Set(['MAT_PLA', 'PO_ITEM', 'SO_ITEM', 'SUPPLIER']);
    const idToType = new Map<string, string>();
    this.baseData.objects.forEach(o => idToType.set(o.id, o.type));

    const setsByFilter: Set<string>[] = [];

    this.filters.forEach(f => {
      const objSet = new Set<string>();
      f.objectIds.forEach(id => {
        objSet.add(id);
        const related = new Set<string>();
        this.baseData!.events.forEach(ev => {
          if (ev.relationships.some(r => r.objectId === id)) {
            ev.relationships.forEach(r => {
              if (
                r.objectId !== id &&
                RELATED_TYPES.has(idToType.get(r.objectId) || '')
              ) {
                related.add(r.objectId);
              }
            });
          }
        });
        related.forEach(o => objSet.add(o));
        if (related.size > 0) {
          console.log(`Object ${id} related objects:`, Array.from(related));
        }
      });
      setsByFilter.push(objSet);
    });

    let triggerIds = new Set<string>();
    if (setsByFilter.length > 0) {
      triggerIds = new Set(setsByFilter[0]);
      for (const s of setsByFilter.slice(1)) {
        triggerIds = new Set([...triggerIds].filter(id => s.has(id)));
      }
    }

    console.log('Applying AND filtering with objects:', Array.from(triggerIds));

    const filteredEvents = this.baseData.events
      .filter(ev => ev.relationships.some(r => triggerIds.has(r.objectId)))
      .map(ev => ({
        ...ev,
        relationships: ev.relationships.filter(r => triggerIds.has(r.objectId))
      }));

    const filteredObjects = this.baseData.objects.filter(obj => triggerIds.has(obj.id));

    const filteredData: OCELData = {
      ...this.baseData,
      events: filteredEvents,
      objects: filteredObjects
    };

    console.log(
      `Filtered OCEL log has ${filteredData.events.length} events and ${filteredData.objects.length} objects`
    );
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
