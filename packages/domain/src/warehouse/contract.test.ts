// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, expectTypeOf, it } from 'vitest';

import { moduleIds } from '../platform/modules.ts';
import {
  dataContractChanges,
  dataContractProblems,
  defineDataContract,
  publishDataContract,
  type DataContract,
  type DataContractClasses,
  type PublishedDataContract,
} from './contract.ts';
import { contributionProblems, dataContracts, type DataContractVersion } from './registry.ts';
import type { ClassificationLookup, WarehouseContribution } from './tables.ts';

/**
 * Each contract as published at each version. A change to a column needs a
 * new version here and in the registry; the old entry stays.
 */
const published: Record<string, Record<number, PublishedDataContract>> = {
  party: {
    1: {
      organisation: {
        key: 'id',
        columns: {
          id: 'uuid internal party.organisation.id',
          status: 'text internal party.party.status',
          name: 'text internal party.organisation.name',
          legal_form: 'text internal party.organisation.legal_form',
          website: 'text? internal party.organisation.website',
          org_id:
            'text? internal party.organisation_identifier.scheme,party.organisation_identifier.identifier',
          org_id_verified:
            'boolean? internal party.organisation_identifier.scheme,party.organisation_identifier.verified_at',
          created_at: 'timestamptz internal party.organisation.created_at',
        },
      },
      person: {
        key: 'id',
        columns: {
          id: 'uuid internal party.person.id',
          status: 'text internal party.party.status',
          created_at: 'timestamptz internal party.person.created_at',
        },
      },
    },
  },
  grants: {
    1: {
      programme: {
        key: 'id',
        columns: {
          id: 'uuid internal grants.programme.id',
          source_module: 'text internal module',
          title: 'text public grants.programme.title',
          summary: 'text public grants.programme.summary',
          status: 'text internal grants.programme.status',
          created_at: 'timestamptz internal grants.programme.created_at',
        },
      },
      commitment: {
        key: 'id',
        columns: {
          id: 'uuid internal grants.decision.id',
          source_module: 'text internal module',
          programme_id: 'uuid internal grants.round.programme_id',
          organisation_id: 'uuid internal grants.application.organisation_id',
          amount_minor: 'bigint internal grants.decision.amount_minor',
          currency: 'text internal grants.decision.currency',
          committed_on: 'date internal grants.decision.released_at,app.tenant.timezone',
        },
      },
      grants_round: {
        key: 'id',
        columns: {
          id: 'uuid internal grants.round.id',
          programme_id: 'uuid internal grants.round.programme_id',
          title: 'text public grants.round.title',
          opens_at: 'timestamptz public grants.round.opens_at',
          closes_at: 'timestamptz public grants.round.closes_at',
          budget_minor: 'bigint internal grants.round.budget_minor',
          award_min_minor: 'bigint public grants.round.award_min_minor',
          award_max_minor: 'bigint public grants.round.award_max_minor',
          currency: 'text public grants.round.currency',
          created_at: 'timestamptz internal grants.round.created_at',
        },
      },
      grants_application: {
        key: 'id',
        columns: {
          id: 'uuid internal grants.application.id',
          round_id: 'uuid internal grants.application.round_id',
          organisation_id: 'uuid internal grants.application.organisation_id',
          applicant_person_id: 'uuid internal grants.application.applicant_person_id',
          status: 'text internal grants.application.status',
          submitted_at: 'timestamptz internal grants.application.submitted_at',
          submitted_late: 'boolean internal grants.application.submitted_late',
          withdrawn_at: 'timestamptz? internal grants.application.withdrawn_at',
          outcome: 'text? internal grants.decision.outcome,grants.decision.released_at',
          commitment_id:
            'uuid? internal grants.decision.id,grants.decision.outcome,grants.decision.released_at',
          created_at: 'timestamptz internal grants.application.created_at',
        },
      },
      grants_score: {
        key: 'id',
        columns: {
          id: 'uuid internal grants.score.id',
          application_id: 'uuid internal grants.assignment.application_id',
          round_id: 'uuid internal grants.assignment.round_id',
          stage_id: 'uuid internal grants.score.stage_id',
          assignment_id: 'uuid internal grants.score.assignment_id',
          criterion_id: 'uuid internal grants.score.criterion_id',
          criterion: 'text internal grants.rubric_criterion.label',
          weight: 'integer internal grants.rubric_criterion.weight',
          score: 'integer internal grants.score.score',
          submitted_at: 'timestamptz internal grants.assignment.submitted_at',
        },
      },
    },
  },
};

/** Columns a version took after it was published, by module and version. None so far. */
const additions: Record<string, Record<number, string[]>> = {};

const contracts = Object.values(dataContracts).filter((value) => value !== null);

/** Every source the contracts name, at `level`, unless `levels` says otherwise. */
function classify(level: string, levels: Record<string, string> = {}): ClassificationLookup {
  const map: Record<string, Record<string, { sensitivity: string }>> = {};
  for (const contract of contracts) {
    for (const table of Object.values(contract.tables)) {
      for (const { from, class: declared } of Object.values(table.columns)) {
        if (from === 'module') continue;
        for (const source of from) {
          const dot = source.lastIndexOf('.');
          (map[source.slice(0, dot)] ??= {})[source.slice(dot + 1)] = {
            sensitivity: levels[source] ?? (level === 'declared' ? declared : level),
          };
        }
      }
    }
  }
  return map;
}

/** A copy of a contract with one column replaced. */
function withColumn(
  contract: DataContract,
  table: string,
  column: string,
  value: object | undefined,
): DataContract {
  const was = contract.tables[table];
  if (was === undefined) throw new Error(`No table ${table}.`);
  const columns = Object.fromEntries(
    Object.entries(was.columns).filter(([name]) => name !== column),
  ) as Record<string, unknown>;
  if (value !== undefined) columns[column] = { ...was.columns[column], ...value };
  return { ...contract, tables: { ...contract.tables, [table]: { ...was, columns } } } as never;
}

describe('the data contract registry', () => {
  it('has a slot for party, grants and each later module, all known modules', () => {
    expect(Object.keys(dataContracts)).toEqual([
      'party',
      'grants',
      'crm',
      'assure',
      'forms',
      'privacy',
      'insight',
      'impact',
    ]);
    for (const [module, contract] of Object.entries(dataContracts)) {
      expect(moduleIds).toContain(module);
      if (contract !== null) expect(contract.module).toBe(module);
    }
  });

  it('holds party and grants at version 1, and the later slots empty', () => {
    expect(dataContracts.party.version).toBe(1);
    expect(dataContracts.grants.version).toBe(1);
    expect(Object.keys(dataContracts.party.tables)).toEqual(['organisation', 'person']);
    expect(Object.keys(dataContracts.grants.tables)).toEqual([
      'programme',
      'commitment',
      'grants_round',
      'grants_application',
      'grants_score',
    ]);
    for (const module of ['crm', 'assure', 'forms', 'privacy', 'insight', 'impact'] as const) {
      expect(dataContracts[module]).toBeNull();
    }
  });

  it('keeps every contract as published at its version', () => {
    for (const contract of contracts) {
      const was = published[contract.module]?.[contract.version];
      if (was === undefined)
        throw new Error(`${contract.module} ${contract.version} is not published here.`);
      const { breaking, added } = dataContractChanges(was, contract);
      expect(breaking, contract.module).toEqual([]);
      expect(added, contract.module).toEqual(additions[contract.module]?.[contract.version] ?? []);
    }
  });

  it('matches the real classification map, column by column', async () => {
    // Loaded by path at run time: the db package depends on this one, not the other way.
    const { dirname } = import.meta as unknown as { dirname: string };
    const { classification } = (await import(`${dirname}/../../../db/classification.ts`)) as {
      classification: ClassificationLookup;
    };
    for (const contract of contracts) {
      expect(dataContractProblems(contract, classification), contract.module).toEqual([]);
    }
  });

  it('is sound against a map that classes every source as its column', () => {
    for (const contract of contracts) {
      expect(dataContractProblems(contract, classify('declared'))).toEqual([]);
    }
  });

  it('calls a programme a programme, never by its retired name (ADR 0016)', () => {
    for (const contract of contracts) {
      for (const [name, table] of Object.entries(contract.tables)) {
        expect(name).not.toMatch(/(?:^|_)fun[d](?:_|$)/);
        for (const column of Object.keys(table.columns))
          expect(column).not.toMatch(/(?:^|_)fun[d](?:_|$)/);
      }
    }
  });

  it('types a contribution by its slot: version 1 for grants, none for crm', () => {
    expectTypeOf<DataContractVersion<'grants'>>().toEqualTypeOf<1>();
    expectTypeOf<DataContractVersion<'crm'>>().toBeNever();
    expectTypeOf<WarehouseContribution<'party', unknown>['contractVersion']>().toEqualTypeOf<
      1 | undefined
    >();
  });

  it('checks a contribution against its slot', () => {
    expect(contributionProblems({ module: 'grants', contractVersion: 1 })).toEqual([]);
    expect(contributionProblems({ module: 'grants' })).toEqual([
      'The grants contribution must emit data contract version 1.',
    ]);
    expect(contributionProblems({ module: 'party', contractVersion: 2 })).toHaveLength(1);
    expect(contributionProblems({ module: 'crm', contractVersion: 1 })).toEqual([
      'crm has no data contract.',
    ]);
    expect(contributionProblems({ module: 'platform' })).toEqual([
      'platform has no data contract.',
    ]);
  });
});

describe('defineDataContract', () => {
  const party = {
    organisation: dataContracts.party.tables.organisation.columns,
    person: dataContracts.party.tables.person.columns,
  };
  const classes = Object.fromEntries(
    Object.entries(party).map(([table, columns]) => [
      table,
      Object.fromEntries(Object.entries(columns).map(([name, value]) => [name, value.class])),
    ]),
  ) as unknown as DataContractClasses<'party'>;

  it('takes types and sources from the model, adding only the class', () => {
    expect(dataContracts.party.tables.person.columns.id).toEqual({
      type: 'uuid',
      nullable: false,
      from: ['party.person.id'],
      class: 'internal',
    });
  });

  it('refuses a personal or special category class, even through a cast', () => {
    for (const level of ['personal', 'special_category']) {
      const bad = { ...classes, person: { ...classes.person, status: level } } as never;
      expect(() => defineDataContract('party', 1, bad)).toThrow(
        'person.status must be public or internal.',
      );
    }
  });

  it('refuses a model column whose source never leaves', () => {
    // The model names none today; a contract built over one would fail here.
    expect(
      Object.values(dataContracts.grants.tables)
        .flatMap(({ columns }) =>
          Object.values(columns).flatMap(({ from }) => (from === 'module' ? [] : from)),
        )
        .filter((source) => /monitoring|\.answers$/.test(source)),
    ).toEqual([]);
  });

  it('refuses a missing or extra column, another module’s table and a bad version', () => {
    const short: Record<string, string> = { ...classes.person };
    delete short['status'];
    expect(() => defineDataContract('party', 1, { ...classes, person: short } as never)).toThrow(
      'must class every column of person once',
    );
    const extra = { ...classes, person: { ...classes.person, email: 'internal' } } as never;
    expect(() => defineDataContract('party', 1, extra)).toThrow('every column of person');
    const other = { ...classes, grants_score: {} } as never;
    expect(() => defineDataContract('party', 1, other)).toThrow(
      'party does not feed the table grants_score.',
    );
    expect(() => defineDataContract('party', 0, classes)).toThrow('whole number from 1');
    expect(() => defineDataContract('party', 1.5, classes)).toThrow('whole number from 1');
  });
});

describe('dataContractProblems', () => {
  const grants = dataContracts.grants;

  it('fails a column whose source is personal or special category', () => {
    for (const level of ['personal', 'special_category']) {
      const map = classify('declared', { 'grants.score.score': level });
      expect(dataContractProblems(grants, map)).toEqual([
        `grants_score.score comes from grants.score.score, which is ${level}.`,
      ]);
    }
  });

  it('fails a column whose source the map does not list', () => {
    const map = classify('declared');
    const rest = { ...map['grants.score'] };
    delete rest['score'];
    expect(dataContractProblems(grants, { ...map, 'grants.score': rest })).toEqual([
      'grants_score.score comes from grants.score.score, which the classification map does not list.',
    ]);
  });

  it('fails a class that is not its sources’ most sensitive level', () => {
    const map = classify('declared', { 'grants.round.title': 'internal' });
    expect(dataContractProblems(grants, map)).toEqual([
      'grants_round.title is classed public, but its sources are internal.',
    ]);
    const wider = withColumn(grants, 'grants_score', 'score', { class: 'public' });
    expect(dataContractProblems(wider, classify('declared'))).toEqual([
      'grants_score.score is classed public, but its sources are internal.',
    ]);
  });

  it('fails a personal class written past the types, and a public module id', () => {
    const personal = withColumn(grants, 'grants_score', 'score', { class: 'personal' });
    expect(dataContractProblems(personal, classify('declared'))).toContain(
      'grants_score.score must be public or internal.',
    );
    const module = withColumn(grants, 'programme', 'source_module', { class: 'public' });
    expect(dataContractProblems(module, classify('declared'))).toEqual([
      'programme.source_module holds a module id, so is internal.',
    ]);
  });

  it('fails a monitoring answer or an application’s answers, whatever their class', () => {
    const declared = classify('declared');
    const map = {
      ...declared,
      'grants.monitoring_response': { region: { sensitivity: 'internal' } },
      'grants.application': {
        ...declared['grants.application'],
        answers: { sensitivity: 'internal' },
      },
    };
    for (const source of ['grants.monitoring_response.region', 'grants.application.answers']) {
      const named = withColumn(grants, 'grants_score', 'score', { from: [source] });
      expect(dataContractProblems(named, map)).toEqual([
        `grants_score.score names ${source}, which never leaves.`,
      ]);
    }
  });
});

describe('dataContractChanges', () => {
  const grants = dataContracts.grants;
  const was = publishDataContract(grants);

  it('finds a removed, renamed, retyped, re-sourced or reclassed column', () => {
    const { score } = grants.tables.grants_score.columns;
    expect(
      dataContractChanges(was, withColumn(grants, 'grants_score', 'score', undefined)),
    ).toEqual({
      breaking: ['grants_score.score removed'],
      added: [],
    });
    const renamed = withColumn(
      withColumn(grants, 'grants_score', 'score', undefined),
      'grants_score',
      'points',
      score,
    );
    expect(dataContractChanges(was, renamed)).toEqual({
      breaking: ['grants_score.score removed'],
      added: ['grants_score.points'],
    });
    for (const change of [
      { type: 'text' },
      { nullable: true },
      { from: ['grants.score.points'] },
      { class: 'public' },
    ]) {
      expect(dataContractChanges(was, withColumn(grants, 'grants_score', 'score', change))).toEqual(
        { breaking: ['grants_score.score changed'], added: [] },
      );
    }
  });

  it('finds an added column or table, and a removed table or changed key', () => {
    const { score } = grants.tables.grants_score.columns;
    expect(dataContractChanges(was, withColumn(grants, 'grants_score', 'band', score))).toEqual({
      breaking: [],
      added: ['grants_score.band'],
    });
    const { grants_score: scores, ...fewer } = grants.tables;
    expect(dataContractChanges(was, { ...grants, tables: fewer }).breaking).toEqual([
      'grants_score removed',
    ]);
    const more = { ...grants, tables: { ...grants.tables, grants_extra: scores } };
    expect(dataContractChanges(was, more).added).toEqual(['grants_extra']);
    const rekeyed = {
      ...grants,
      tables: { ...grants.tables, grants_score: { ...scores, key: 'score' } },
    };
    expect(dataContractChanges(was, rekeyed).breaking).toEqual(['grants_score key changed']);
  });
});
