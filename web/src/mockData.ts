export const mockShelters = [
  {
    id: 'sh_001',
    name: 'Downtown Hope Center',
    address: '124 Main St, Civic District',
    capacity: 120,
    occupancy: 115,
    status: 'nearing_capacity',
    paramedicFreq: 'High (3/week)',
    policeFreq: 'Medium (1/week)',
    occupancy30d: [80, 85, 90, 95, 98, 96, 92, 95, 99, 95]
  },
  {
    id: 'sh_002',
    name: 'Riverside Safe Haven',
    address: '88 River Rd, Westside',
    capacity: 50,
    occupancy: 50,
    status: 'critical',
    paramedicFreq: 'Low (1/month)',
    policeFreq: 'Low (1/month)',
    occupancy30d: [100, 100, 100, 98, 100, 100, 100, 100, 100, 100]
  },
  {
    id: 'sh_003',
    name: 'Northway Family Shelter',
    address: '450 Northway Ave, North District',
    capacity: 200,
    occupancy: 140,
    status: 'stable',
    paramedicFreq: 'Medium (2/month)',
    policeFreq: 'Low (1/month)',
    occupancy30d: [60, 65, 70, 72, 70, 68, 70, 75, 70, 70]
  }
];

export const mockPeople = [
  {
    id: 'p_001',
    name: 'Marcus T. (Sample)',
    vulnerabilityScore: 8.5,
    status: 'Unsheltered',
    lastSeen: '2 hours ago',
    repeatOverdose: 2,
    policeEncounters: 5,
    paramedicCalls: 3,
    assignedShelter: null,
    caseManager: 'Sarah J.',
    notes: 'Frequent ER visits. High priority for supportive housing.'
  },
  {
    id: 'p_002',
    name: 'Elena R. (Sample)',
    vulnerabilityScore: 4.2,
    status: 'Sheltered',
    lastSeen: 'Currently in Sh_003',
    repeatOverdose: 0,
    policeEncounters: 1,
    paramedicCalls: 0,
    assignedShelter: 'Northway Family Shelter',
    caseManager: 'David M.',
    notes: 'Stable for 3 weeks. Enrolled in job training.'
  },
  {
    id: 'p_003',
    name: 'James W. (Sample)',
    vulnerabilityScore: 9.1,
    status: 'Emergency',
    lastSeen: '10 mins ago - EMS dispatched',
    repeatOverdose: 4,
    policeEncounters: 12,
    paramedicCalls: 8,
    assignedShelter: null,
    caseManager: 'Sarah J.',
    notes: 'Severe chronic health issues. Refuses traditional shelter.'
  }
];

export const mockIncidents = [
  {
    id: 'inc_001',
    type: 'Medical Emergency',
    location: '14th & Broadway',
    time: '10 mins ago',
    status: 'active',
    severity: 'critical',
    person: 'James W. (Sample)'
  },
  {
    id: 'inc_002',
    type: 'Warming Check',
    location: 'Underpass I-95',
    time: '1 hour ago',
    status: 'resolved',
    severity: 'stable',
    person: 'Multiple'
  }
];

export const opsKPIs = {
  totalBeds: 370,
  occupiedBeds: 305,
  capacityGap: 45,
  activeIncidents: 3,
  outreachTeamsActive: 4,
  weatherAlert: 'Code Blue (Freezing Temp)'
};
