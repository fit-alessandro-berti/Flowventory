import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ViewStateService {
  private viewSubject = new BehaviorSubject<string>('events');
  view$ = this.viewSubject.asObservable();

  setView(view: string): void {
    this.viewSubject.next(view);
  }

  get currentView(): string {
    return this.viewSubject.value;
  }
}
