import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { OCELData, OCELEvent, OCELObject } from '../models/ocel.model';

@Injectable({
  providedIn: 'root'
})
export class OcelDataService {
  private ocelDataSubject = new BehaviorSubject<OCELData | null>(null);
  public ocelData$ = this.ocelDataSubject.asObservable();

  constructor(private http: HttpClient) {
    this.loadOCELData();
  }

  private loadOCELData(): void {
    this.http.get<OCELData>('/assets/example_ocel.json').subscribe({
      next: (data) => {
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

  getObjectById(id: string): OCELObject | undefined {
    const data = this.ocelDataSubject.value;
    return data?.objects.find(obj => obj.id === id);
  }

  getObjectTypes(): string[] {
    const data = this.ocelDataSubject.value;
    return data?.objectTypes.map(type => type.name) || [];
  }
}
