import {appInit,appBuilder} from '../src/index';
import {assert} from 'chai';
import {Observable} from 'rx';
import {assign} from 'lodash';
import {testRig, fooAct, countUp} from './_testSupport';

describe('appInit supports', ()=> {

  it('simple appFunc', ()=> {
    
    let {getCount} = testRig(b => b.addAppFunc('foo', countUp));
    
    assert.equal(getCount(fooAct),2);
  });

  it('two appFuncs', ()=> {
    
    const countThree = (state, item) => ({ count: state().count + 3 });

    let {getCount} = testRig(b => b.addAppFunc('foo',countUp).addAppFunc('bar',countThree));
    
    assert.equal(getCount(fooAct), 2);
    assert.equal(getCount({ type: 'bar' }), 5);
    assert.equal(getCount(fooAct), 6);
  });

  it('action sources', ()=> {

    let { getCurrentState} = testRig(b => b
      .addAppFunc('foo', countUp)
      .addActionSource(Observable.return({ type:'foo' })));

    assert.equal(getCurrentState().count, 2);
  });

  it('async app funcs', (cb)=> {
    const app = appBuilder()
      .addAsyncAppFunc('foo', (state,item) => Promise.resolve({ count: state().count + 1 }))
      .setInitialState({ count: 0 })
      .build();
    let {dispatchAction,stateObservable} = appInit(app);
    
    stateObservable.subscribe(s => {
      assert.equal(s.count, 1);
      cb();
    });
    dispatchAction(fooAct);
  });

  it('a func selector', ()=> {

    let {getCount} = testRig(b => b
      .addAppFunc(a => a.type.startsWith('f'), countUp));

    assert.equal(getCount({type: 'ar'}), 1);
    assert.equal(getCount({type: 'foo'}), 2);
    assert.equal(getCount({type: 'fa'}), 3);

  });

  it('appfuncs that want to dispatch', ()=> {
    
    const [multiply,dispatchFunc] = [
      (state,item) => ({ count: state().count * 2 }),
      (state,item,dispatch) => {
        dispatch({type: 'foo'});
        return { count: state().count + 1 };
      }];

    let {getCount} = testRig(b => b
      .addAppFunc('foo', multiply)
      .addAppFunc('bar', dispatchFunc));

    assert.equal(getCount({ type: 'bar'}), 3);
  });

  it('multiple appfuncs on same action, in sequence of addition', ()=> {
    const multiply = (state,item) => ({ count: state().count * 2 });
    
    let {getCount} = testRig(b => b
      .addAppFunc('foo', multiply)
      .addAppFunc('foo', countUp));

    assert.equal(getCount(fooAct), 3);
  });

  it('state sugar to enrich state', ()=> {

    let {getCount} = testRig(b => b
      .addAppFunc('foo',countUp)
      .addStateRefinement(s => ({ count: s.count * 2 })));

    // s1 (1) -> sugar -> s2 (2) -> foo -> s3 (3) -> sugar -> s4 (6)
    assert.equal(getCount(fooAct), 6); 
  });

  it('calling state sugar AFTER the action-based mutation', ()=> {

    let {getState} = testRig(b => b
      .addAppFunc('foo',countUp)
      .addStateRefinement(s => s.count == 2 ? assign(s, { seeState: true }) : s));

    assert.isTrue(getState(fooAct).seeState); 
  });

  it('multiple sugar to enrich state', ()=> {

    let {getCount} = testRig(b => b
      .addAppFunc('foo', countUp)
      .addStateRefinement(s => ({ count: s.count * 2 }))
      .addStateRefinement(s => ({ count: s.count + 1 })));

    // (1) -> sg1 -> (2) -> sg2 -> (3) -> foo -> (4) -> sg1 -> (8) -> sg2 -> (9)
    assert.equal(getCount(fooAct), 9); 
  });

  it('dispatching an observable', ()=> {

    let {getCount} = testRig(b => b
      .addAppFunc('foo', countUp)
      .addAppFunc('bar', (s,a,d) => d(Observable.fromArray([fooAct, fooAct]))));

    assert.equal(getCount({ type: 'bar' }), 3);
  });

});

describe('appInit with problems', ()=> {

  it('ignores state Sugar that returns nothing', ()=> {

    let {getCurrentState} = testRig(b => b
      .addStateRefinement(s => {if (s.count > 1) return { count: 5}; }));

    assert.isObject(getCurrentState());
    assert.equal(getCurrentState().count, 1);
  });

  it('ignores appfuncs returning undefined', ()=> {

    const noReturnVal = (state,item) => {
      const whatevs = { count: state().count * 2 };
      //Not returning anything, cause I have nothing to say
    };

    let {getCount} = testRig(b => b.addAppFunc('foo', noReturnVal));

    assert.equal(getCount(fooAct), 1);
  });

});

describe('appInit with exceptions', ()=> {
  it('supports a dying app func', ()=> {

    let {getCount} = testRig(b => b
      .addAppFunc('foo', (state, item) => { 
        if (item.die)
          throw new Error("die");
        else
          return { count: state().count + 1 };
      }));

    assert.equal(getCount({ type: 'foo', die: true }), 1);
    assert.equal(getCount({ type: 'foo', die: false }), 2);
  });

  it('converts an error to a dispatch', ()=> {
    let error = undefined;
    const app = appBuilder()
      .addAppFunc('foo', (state, item) => { throw new Error("die"); })
      .addAppFunc('error', (state, item) => error = item)
      .setInitialState({ count: 0 })
      .build();
    let {dispatchAction} = appInit(app);
    dispatchAction({ type: 'foo'});
    assert.isDefined(error);
    assert.equal(error.error.message, "die");
  });

  it('supports a rejected promise', (cb)=> {
    let error = undefined;
    const app = appBuilder()
      .addAsyncAppFunc('foo', (state,item) => Promise.reject(Error("argh")))
      .setInitialState({ count: 0 })
      .build();

    let {dispatchAction,actionObservable} = appInit(app);

    actionObservable
    .skipWhile(a => a.type == 'foo')
    .subscribe(a => {
      assert.equal(a.error.message, "argh");
      cb();
    });

    dispatchAction({ type: 'foo'});
  });

  it('supports errorListener API', ()=> {
    let error = undefined;
    const app = appBuilder()
      .addAppFunc('foo', (state, item) => { throw new Error("die"); })
      .addErrorListener((state, item) => { error = item; })
      .build();
    let {dispatchAction} = appInit(app);
    dispatchAction({ type: 'foo'});
    assert.isDefined(error);
    assert.equal(error.error.message, "die");
  });

  it('supports dying sugar', (cb)=> {
    let error = undefined;
    const app = appBuilder()
      .addStateRefinement(state => { throw new Error("die"); })
      .addErrorListener((state, item) => { 
        error = item; 
      })
      .build();

    let {actionObservable} = appInit(app);
    actionObservable.subscribe(a => {
      //Initial state is observed, so we already should have an error...
      assert.isDefined(error);
      assert.equal(error.error.message, "die");
      cb();
    })
    

  });

  it ('supports misbehaved async func returning undefined', ()=> {

    const app = appBuilder()
      .addAsyncAppFunc('foo', (state,item) => {  })
      .addAppFunc('bar', countUp)
      .setInitialState({ count: 0 })
      .build();

    let {dispatchAction,getCurrentState} = appInit(app);
    
    assert.doesNotThrow(()=> { dispatchAction(fooAct); });
    dispatchAction({type: 'bar'});
    assert.equal(getCurrentState().count, 1);

  });
});



