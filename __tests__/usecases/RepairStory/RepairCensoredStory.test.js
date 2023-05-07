const { makeGame } = require("../../../doubles/entities/makeGame");
const { FakeGameRepository } = require("../../../doubles/repositories/FakeGameRepository");
const { Game } = require("../../../entities/Game");
const { UserNotInGame, InvalidPlayerActivity } = require("../../../entities/Game.Exceptions");
const { PlayerActivity } = require("../../../entities/Game.PlayerActivity");
const { StoryStatus } = require("../../../entities/Game.Story.Status");
const { GameNotFound } = require("../../../repositories/GameRepositoryExceptions");
const { RepairStory } = require("../../../usecases/RepairStory");
const { MustHaveLength } = require("../../../usecases/validation");
const { contract, isRequired, mustBeString, mustBeNumber, mustBeArray } = require("../../contracts");

/** @type {FakeGameRepository} */
let games;
/** @type {RepairStory} */
let repairStory;

beforeEach(() => {
    games = new FakeGameRepository();
    repairStory = new RepairStory(games);
});

describe("Repair a Censored Story", () => {
    describe("contract", () => {
        contract("gameId", (name) => {
            isRequired(name, () => {
                // @ts-ignore
                return repairStory.repairStory();
            });
            mustBeString(name, (gameId) => {
                // @ts-ignore
                return repairStory.repairStory(gameId);
            });
        });
        contract("playerId", (name) => {
            isRequired(name, () => {
                // @ts-ignore
                return repairStory.repairStory("game-id");
            });
            mustBeString(name, (playerId) => {
                // @ts-ignore
                return repairStory.repairStory("game-id", playerId);
            });
        });
        contract("storyIndex", (name) => {
            isRequired(name, () => {
                // @ts-ignore
                return repairStory.repairStory("game-id", "player-id");
            });
            mustBeNumber(name, (nonNumber) => {
                // @ts-ignore
                return repairStory.repairStory("game-id", "player-id", nonNumber);
            });
        });
    });

    test("game must exist", async () => {
        const rejection = expect(repairStory.repairStory("unknown-game-id", "user-id", 0, [])).rejects;
        await rejection.toThrow(GameNotFound);
    });

    describe("given the game exists", () => {
        /** @type {Game & {id: string}} */
        let game;
        beforeEach(async () => {
            game = await games.add(makeGame());
        });

        test("player must be in the game", async () => {
            const rejection = expect(repairStory.repairStory(game.id, "unknown-user-id", 0, [])).rejects;
            await rejection.toThrow(UserNotInGame);
        });

        describe("given the user is in the game", () => {
            beforeEach(() => {
                game.addPlayer("user-id");
            });

            test("the game must have started", async () => {
                const rejection = expect(repairStory.repairStory(game.id, "user-id", 0, [])).rejects;
                await rejection.toThrow(InvalidPlayerActivity);
            });

            describe("given the game has started", () => {
                beforeEach(() => {
                    game.addPlayer("player-2");
                    game.addPlayer("player-3");
                    game.addPlayer("player-4");
                    game.start();
                });

                test("the player must have started a story", async () => {
                    const rejection = expect(repairStory.repairStory(game.id, "user-id", 0, [])).rejects;
                    await rejection.toThrow(InvalidPlayerActivity);
                });

                describe("given the player has started a story", () => {
                    beforeEach(() => {
                        game.startStory("user-id", "content one");
                    });

                    test("a story must be assigned to the player for repair", async () => {
                        const rejection = expect(repairStory.repairStory(game.id, "user-id", 0, [])).rejects;
                        await rejection.toThrow(InvalidPlayerActivity);
                    });

                    describe("given the player has been assigned a story to repair", () => {
                        beforeEach(() => {
                            game.startStory("player-3", "content two");
                            game.startStory("player-4", "content four");
                            game.censorStory("player-4", 1, [1]);
                        });

                        test("the storyIndex must be the assigned story to repair", async () => {
                            const rejection = expect(repairStory.repairStory(game.id, "user-id", 2, [])).rejects;
                            await rejection.toThrow(InvalidPlayerActivity);
                        });

                        contract("replacements", (name) => {
                            isRequired(name, () => {
                                // @ts-ignore
                                return repairStory.repairStory(game.id, "user-id", 1);
                            });
                            mustBeArray(name, (nonArray) => {
                                return repairStory.repairStory(game.id, "user-id", 1, nonArray);
                            });
                            it("must have length equal to number of censored words", async () => {
                                const rejection = expect(repairStory.repairStory(game.id, "user-id", 1, [])).rejects;
                                await rejection.toThrow(MustHaveLength);
                                await rejection.toThrow("replacements must have length of 1");
                            });
                            it("must only contain strings", async () => {
                                // @ts-ignore
                                const rejection = expect(repairStory.repairStory(game.id, "user-id", 1, [14])).rejects;
                                await rejection.toThrow(TypeError);
                                await rejection.toThrow("each value of replacements must be a string.");
                            });
                        });

                        test("the player is redacting a story", async () => {
                            await repairStory.repairStory(game.id, "user-id", 1, ["replaced"]);
                            const savedGame = (await games.get(game.id)) || fail("failed to get game.");
                            expect(savedGame.playerActivity("user-id")).toEqual(
                                PlayerActivity.RedactingStory(2, "content four")
                            );
                        });

                        test("the story is awaiting a continuation from the next player", async () => {
                            await repairStory.repairStory(game.id, "user-id", 1, ["replaced"]);
                            const savedGame = (await games.get(game.id)) || fail("failed to get game.");
                            expect(savedGame.storyActionRequired(1)).toEqual(StoryStatus.Continue.action);
                            expect(savedGame.playerAssignedToStory(1)).toEqual("player-2");
                        });

                        describe("the player already redacted the other story", () => {
                            beforeEach(() => {
                                game.censorStory("user-id", 2, [1]);
                            });

                            test("the player is awaiting a story", async () => {
                                await repairStory.repairStory(game.id, "user-id", 1, ["replaced"]);
                                const savedGame = (await games.get(game.id)) || fail("failed to get game.");
                                expect(savedGame.playerActivity("user-id")).toEqual(PlayerActivity.AwaitingStory);
                            });
                        });

                        describe("given the story has reached its maximum number of entries", () => {
                            beforeEach(() => {
                                game.maxStoryEntries = 1;
                            });

                            test("the story is completed", async () => {
                                await repairStory.repairStory(game.id, "user-id", 1, ["replaced"]);
                                const savedGame = (await games.get(game.id)) || fail("failed to get game.");
                                expect(savedGame.storyActionRequired(1)).toEqual(StoryStatus.Completed.action);
                            });
                        });
                    });
                });
            });
        });
    });
});
