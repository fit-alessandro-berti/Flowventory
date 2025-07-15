import { TestBed } from '@angular/core/testing';

import { OcelDataService } from './ocel-data.service';

describe('OcelDataService', () => {
  let service: OcelDataService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(OcelDataService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
