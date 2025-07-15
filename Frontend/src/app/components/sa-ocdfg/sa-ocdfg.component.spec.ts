import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SaOcdfgComponent } from './sa-ocdfg.component';

describe('SaOcdfgComponent', () => {
  let component: SaOcdfgComponent;
  let fixture: ComponentFixture<SaOcdfgComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SaOcdfgComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(SaOcdfgComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
