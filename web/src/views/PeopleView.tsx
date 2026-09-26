import React from 'react';
import { mockPeople } from '../mockData';

export function PeopleView() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">People & Case Management</h1>
          <div className="page-subtitle">Vulnerability tracking, chronic support, and outreach planning.</div>
        </div>
        <button className="btn btn-primary">New Client Intake</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Client Name</th>
              <th>Status</th>
              <th>Vulnerability</th>
              <th>Emergency History (OD/Pol/Med)</th>
              <th>Assigned Shelter / Last Seen</th>
              <th>Case Manager</th>
            </tr>
          </thead>
          <tbody>
            {mockPeople.map(person => {
              let vulnColor = 'green';
              if (person.vulnerabilityScore > 6) vulnColor = 'amber';
              if (person.vulnerabilityScore > 8) vulnColor = 'red';

              return (
                <tr key={person.id}>
                  <td style={{ fontWeight: 600, color: 'var(--purple)' }}>{person.name}</td>
                  <td>
                    <span className={`badge ${person.status === 'Emergency' ? 'red' : person.status === 'Unsheltered' ? 'amber' : 'green'}`}>
                      {person.status}
                    </span>
                  </td>
                  <td>
                    <div className={`flex-center gap-2 text-${vulnColor}`}>
                      <strong>{person.vulnerabilityScore}</strong> / 10
                    </div>
                  </td>
                  <td>
                    <div className="flex-center gap-3 text-muted">
                      <span title="Overdoses" className={person.repeatOverdose > 0 ? 'text-red' : ''}>💉 {person.repeatOverdose}</span>
                      <span title="Police Encounters">👮 {person.policeEncounters}</span>
                      <span title="Paramedic Calls">🚑 {person.paramedicCalls}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.875rem' }}>
                      {person.assignedShelter ? <strong>{person.assignedShelter}</strong> : <span className="text-muted">None</span>}
                      <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '2px' }}>
                        {person.lastSeen}
                      </div>
                    </div>
                  </td>
                  <td>{person.caseManager}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
