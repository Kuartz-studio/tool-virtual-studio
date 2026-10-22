// Ce qui sert à essayer la plateforme des jeux sans les vrais jeux : le morpion jetable (jamais au registre), les jeux faux exprès que le harnais de conformité
// doit attraper, et le harnais lui-même. Importé comme `@bureau/shared/games/testing`.
export * from './tictactoe';
export * from './broken';
// Le harnais de conformité et le rejeu d'un journal servent aussi aux tests du serveur.
export * from '../conformance';
