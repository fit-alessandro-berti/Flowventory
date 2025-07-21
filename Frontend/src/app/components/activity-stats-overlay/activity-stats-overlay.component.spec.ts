import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ActivityStatsOverlayComponent } from './activity-stats-overlay.component';

describe('ActivityStatsOverlayComponent', () => {
  let component: ActivityStatsOverlayComponent;
  let fixture: ComponentFixture<ActivityStatsOverlayComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ActivityStatsOverlayComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ActivityStatsOverlayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
