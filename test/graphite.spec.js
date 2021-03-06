'use strict';

let juttle_test_utils = require('juttle/test').utils;
var check_juttle = juttle_test_utils.check_juttle;
var expect = require('chai').expect;
var path = require('path');
var retry = require('bluebird-retry');
var uuid = require('uuid');

juttle_test_utils.configureAdapter({
    graphite: {
        path: path.resolve(__dirname, '..'),
        carbon: {
            host: 'localhost',
            port: 2003
        },
        webapp: {
            host: 'localhost',
            port: 8080,
            username: 'guest',
            password: 'guest'
        }
    }
});

juttle_test_utils.withAdapterAPI(() => {
    describe('graphite-adapter API tests', () => {

        it('fails when provided an invalid filter expression', () => {
            return check_juttle({
                program: 'read graphite -from :5 minutes ago: badfield="metric.does.not.exist"'
            })
            .then(() => {
                throw Error('Previous statement should have failed');
            })
            .catch((err) => {
                expect(err.message).to.contain('filter expression must match: name="XXX"/name~"X.*"');
            });
        });

        it('fails when not provided -from/-to or -last', () => {
            return check_juttle({
                program: 'read graphite name="foo"'
            })
            .then(() => {
                throw Error('Previous statement should have failed');
            })
            .catch((err) => {
                expect(err.code).to.equal('MISSING-TIME-RANGE');
            });
        });

        it('warns when you attempt to write a point without the field "name"', () => {
            return check_juttle({
                program: 'emit -limit 1 | put value=count() | write graphite'
            })
            .then((result) => {
                expect(result.errors.length).equal(0);
                expect(result.warnings.length).equal(1);
                expect(result.warnings[0]).to.match(/required field "name" not found in data/);
            });
        });

        it('warns when you attempt to write a point without the field "value"', () => {
            return check_juttle({
                program: 'emit -limit 1 | put name="foo" | write graphite'
            })
            .then((result) => {
                expect(result.errors.length).equal(0);
                expect(result.warnings.length).equal(1);
                expect(result.warnings[0]).to.match(/required field "value" not found in data/);
            });
        });

        it('handles reading no points with -last', () => {
            return check_juttle({
                program: 'read graphite -last :5 minutes: name="metric.does.not.exist"'
            })
            .then((result) => {
                expect(result.errors.length).equal(0);
                expect(result.warnings.length).equal(0);
                expect(result.sinks.table.length).equal(0);
            });
        });

        it('handles reading no points with -from/-to', () => {
            return check_juttle({
                program: 'read graphite -from :5 minutes ago: -to :now: name="metric.does.not.exist"'
            })
            .then((result) => {
                expect(result.errors.length).equal(0);
                expect(result.warnings.length).equal(0);
                expect(result.sinks.table.length).equal(0);
            });
        });

        it('fails when provided an unknown option', () => {
            return check_juttle({
                program: 'read graphite -from :1 minute ago: -unknown "bananas" name="metric.*"'
            })
            .then(() => {
                throw Error('Previous statement should have failed');
            }).catch((err) => {
                expect(err.message).to.contain('unknown read-graphite option unknown');
            });
        });

        it('can read "live" points', () => {
            var uniqueness = uuid.v1().substring(0, 6);

            return check_juttle({
                // pushing the point 2s into the future to simulate live
                program: 'emit -from :now: -limit 1 ' +
                        '| put name="metric' + uniqueness + '", value = count(), time = time + :2s: ' +
                        '| write graphite'
            })
            .then((result) => {
                expect(result.errors.length).equal(0);
                expect(result.warnings.length).equal(0);
            })
            .then(() => {
                return check_juttle({
                    program: 'read graphite -to :end: name="metric' + uniqueness + '"',
                    realtime: true,
                    deactivateAfter: 10000
                })
                .then((result) => {
                    expect(result.errors.length).equal(0);
                    expect(result.warnings.length).equal(0);
                    expect(result.sinks.table.length).equal(1);
                    expect(result.sinks.table[0].name).equal('metric' + uniqueness);
                    expect(result.sinks.table[0].value).equal(1);
                });
            });
        });

        it('can write a metric with value 0 and then read it back', () => {
            var uniqueness = uuid.v1().substring(0, 6);
            var now = new Date();
            // graphite can only store points with second precision
            now.setMilliseconds(0);
            now = now.toISOString();

            return check_juttle({
                program: 'emit -from :' + now + ': -limit 1 ' +
                    '| put name="metric' + uniqueness + '", value = 0 | write graphite'
            })
            .then((result) => {
                expect(result.errors.length).equal(0);
            })
            .then(() => {
                return retry(() => {
                    return check_juttle({
                        // -:1s: becuase from is exclusive
                        program: 'read graphite -from :' + now + ':-:1s: -to :now: name="metric' + uniqueness + '"'
                    })
                    .then((result) => {
                        expect(result.errors.length).equal(0);
                        expect(result.warnings.length).equal(0);
                        expect(result.sinks.table.length).equal(1);
                        expect(result.sinks.table[0].time).equal(now);
                        expect(result.sinks.table[0].name).equal('metric' + uniqueness);
                        expect(result.sinks.table[0].value).equal(0);
                    });
                }, { interval:250, timeout: 5000});
            });
        });

        it('can write a metric and then read it back', () => {
            var uniqueness = uuid.v1().substring(0, 6);
            var now = new Date();
            // graphite can only store points with second precision
            now.setMilliseconds(0);
            now = now.toISOString();

            return check_juttle({
                program: 'emit -from :' + now + ': -limit 1 ' +
                    '| put name="metric' + uniqueness + '", value = count() | write graphite'
            })
            .then((result) => {
                expect(result.errors.length).equal(0);
            })
            .then(() => {
                return retry(() => {
                    return check_juttle({
                        // -:1s: becuase from is exclusive
                        program: 'read graphite -from :' + now + ':-:1s: -to :now: name="metric' + uniqueness + '"'
                    })
                    .then((result) => {
                        expect(result.errors.length).equal(0);
                        expect(result.sinks.table.length).equal(1);
                        expect(result.sinks.table[0].time).equal(now);
                        expect(result.sinks.table[0].name).equal('metric' + uniqueness);
                        expect(result.sinks.table[0].value).equal(1);
                    });
                }, { interval:1000, timeout: 5000});
            });
        });

        it('can write multiple metrics and then read them back', () => {
            var uniqueness = uuid.v1().substring(0, 6);
            var iterations = 1000;
            return check_juttle({
                program: 'emit -from :1 hour ago: -limit ' + iterations + ' ' +
                    '| put name="metric' + uniqueness + '", value = count() ' +
                    '| write graphite'
            })
            .then((result) => {
                expect(result.errors.length).equal(0);
            })
            .then(() => {
                return retry(() => {
                    return check_juttle({
                        program: 'read graphite -last :2 hours: name="metric' + uniqueness + '"'
                    })
                    .then((result) => {
                        expect(result.errors.length).equal(0);
                        expect(result.sinks.table.length).equal(iterations);
                        for(var index = 0; index < iterations; index ++) {
                            expect(result.sinks.table[index].name).to.be.equal('metric' + uniqueness);
                            expect(result.sinks.table[index].value).to.be.equal(index+1);
                        }
                    });
                }, { interval:1000, timeout: 5000});
            });
        });

        it('can use -from/-to to get at specific values', () => {
            var uniqueness = uuid.v1().substring(0, 6);
            return check_juttle({
                program: 'emit -from :24 hours ago: -limit 24 -every :1 hour:' +
                    '| put name="metric' + uniqueness + '", value = count() ' +
                    '| write graphite'
            })
            .then((result) => {
                expect(result.errors.length).equal(0);
            })
            .then(() => {
                return retry(() => {
                    return check_juttle({
                        // 25 hours ago because time is moving and 24 hours ago
                        // from the moment we did the write is now 24 hours ago + a few seconds
                        program: 'read graphite -last :25 hours: name="metric' + uniqueness + '"'
                    })
                    .then((result) => {
                        expect(result.errors.length).equal(0);
                        expect(result.sinks.table.length).equal(24);
                    });
                }, { interval:1000, timeout: 5000 });
            })
            .then(() => {
                return retry(() => {
                    return check_juttle({
                        program: 'read graphite -last :20 hours: name="metric' + uniqueness + '"'
                    })
                    .then((result) => {
                        expect(result.errors.length).equal(0);
                        expect(result.sinks.table.length).equal(19);
                    });
                }, { interval:1000, timeout: 5000 });
            })
            .then(() => {
                return retry(() => {
                    return check_juttle({
                        program: 'read graphite -from :20 hours ago: -to :3 hours ago: name="metric' + uniqueness + '"'
                    })
                    .then((result) => {
                        expect(result.errors.length).equal(0);
                        expect(result.sinks.table.length).equal(17);
                    });
                }, { interval:1000, timeout: 5000 });
            });
        });

        it('can write a fully qualified metric name and read it back using .*', () => {
            var uniqueness = uuid.v1().substring(0, 6);
            return check_juttle({
                program: 'emit -from :30 seconds ago: -limit 4 ' +
                    '| ( put value = count(), name="metric' + uniqueness + '.region1.host${value}" ;' +
                    '    put value = count(), name="metric' + uniqueness + '.region2.host${value}" )' +
                    '| write graphite'
            })
            .then((result) => {
                expect(result.errors.length).equal(0);
            })
            .then(() => {
                return retry(() => {
                    return check_juttle({
                        program: 'read graphite -last :1 minute: ' +
                            'name~"metric' + uniqueness + '.region2.*"'
                    })
                    .then((result) => {
                        expect(result.errors.length).equal(0);
                        expect(result.sinks.table.length).equal(4);
                        for (var index = 0; index < 4; index++) {
                            expect(result.sinks.table[index].name).to.be.equal('metric' + uniqueness + '.region2.host' + (index+1));
                            expect(result.sinks.table[index].value).to.be.equal(index+1);
                        }
                    });
                }, { interval:1000, timeout: 5000 });
            });
        });
    });
});
