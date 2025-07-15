import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { NavigationComponent } from './components/navigation/navigation.component';
import { EventsTableComponent } from './components/events-table/events-table.component';
import { SaOcdfgComponent } from './components/sa-ocdfg/sa-ocdfg.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, NavigationComponent, EventsTableComponent, SaOcdfgComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'Frontend';
  currentView = 'events';

  onNavigationChange(view: string): void {
    this.currentView = view;
  }
}
