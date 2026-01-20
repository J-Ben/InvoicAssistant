import { RulesEngine } from '../RulesEngine';
import { UserContext } from '../../../domain/entities/UserContext';

// Mock MistralService : je récupère l'existant
jest.mock('../../../infrastructure/api/MistralService', () => {
  return {
    MistralService: jest.fn().mockImplementation(() => {
      return {
        generate: jest.fn().mockResolvedValue('Réponse IA mockée'),
      };
    }),
  };
});

describe('RulesEngine', () => {
  let rulesEngine: RulesEngine;
  let mockContext: UserContext;

  beforeEach(() => {
    rulesEngine = new RulesEngine();
    mockContext = {
      lastVisit: new Date(),
      pendingInvoices: [
        {
          id: 'fact-001',
          clientName: "Service d'Aide à Domicile du 13ème",
          amount: 1250.50,
          status: 'pending',
          createdAt: new Date(),
        },
        {
          id: 'fact-002',
          clientName: "Résidence Les Jardins d'Automne",
          amount: 890.00,
          status: 'pending',
          createdAt: new Date(),
        },
      ],
      recentClients: [
        {
          id: 'cli-001',
          name: "Service d'Aide à Domicile du 13ème",
          lastContact: new Date(),
        },
      ],
    };
  });

  it('répond aux salutations avec le nombre de factures', async () => {
    const response = await rulesEngine.generate('Bonjour', mockContext);
    
    expect(response).toContain('Bonjour');
    expect(response).toContain('2 facture');
  });

  it('affiche la liste des factures en attente', async () => {
    const response = await rulesEngine.generate('Mes factures', mockContext);
    
    expect(response).toContain("Service d'Aide à Domicile du 13ème");
    expect(response).toContain('1250.5');
    expect(response).toContain('890');
  });

  it('affiche les clients récents', async () => {
    const response = await rulesEngine.generate('Mes clients', mockContext);
    
    expect(response).toContain("Service d'Aide à Domicile du 13ème");
    expect(response).toContain('clients récents');
  });

  it('propose de créer une facture', async () => {
    const response = await rulesEngine.generate('Créer une facture', mockContext);
    
    expect(response).toContain('client');
    expect(response).toContain('facture');
  });

  it('affiche le message d aide', async () => {
    const response = await rulesEngine.generate('aide', mockContext);
    
    expect(response).toContain('Consulter');
    expect(response).toContain('Créer');
    expect(response).toContain('clients');
  });

  it('utilise Mistral pour les questions hors règles', async () => {
    const response = await rulesEngine.generate('Question complexe hors règles', mockContext);
    
    expect(response).toBe('Réponse IA mockée');
  });
});